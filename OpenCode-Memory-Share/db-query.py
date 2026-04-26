#!/usr/bin/env python3
"""
查询 opencode 数据库中的新消息
Python sqlite3 原生支持 WAL 模式

用法: python db-query.py <last_synced_time>
输出: JSON 数组，每条消息含 id/time/role/content

本地不做任何过滤，所有 user/assistant 消息直接输出，由服务器去重和清理
"""
import sqlite3
import json
import sys

DB_PATH = r'C:\Users\12527\.local\share\opencode\opencode.db'

def query_messages(last_synced_time):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    if last_synced_time > 0:
        query = """
            SELECT m.id, m.time_created, m.data,
                   (SELECT GROUP_CONCAT(
                        CASE WHEN json_extract(p.data, '$.type') = 'text'
                             THEN json_extract(p.data, '$.text')
                             ELSE NULL END, '')
                    FROM part p WHERE p.message_id = m.id AND json_extract(p.data, '$.type') = 'text') as text_parts
            FROM message m
            WHERE m.time_created > ?
              AND json_extract(m.data, '$.role') IN ('user', 'assistant')
            ORDER BY m.time_created ASC
        """
        rows = conn.execute(query, (last_synced_time,)).fetchall()
    else:
        # 首次运行，只取最近10条
        query = """
            SELECT m.id, m.time_created, m.data,
                   (SELECT GROUP_CONCAT(
                        CASE WHEN json_extract(p.data, '$.type') = 'text'
                             THEN json_extract(p.data, '$.text')
                             ELSE NULL END, '')
                    FROM part p WHERE p.message_id = m.id AND json_extract(p.data, '$.type') = 'text') as text_parts
            FROM message m
            WHERE json_extract(m.data, '$.role') IN ('user', 'assistant')
            ORDER BY m.time_created DESC LIMIT 10
        """
        rows = conn.execute(query).fetchall()

    messages = []
    for row in rows:
        data = json.loads(row['data'])
        content = row['text_parts'] or ''

        # user 消息可能没有 text part，用 summary 替代
        if data.get('role') == 'user' and (not content or content.strip() == ''):
            content = json.dumps(data.get('summary', '')) if data.get('summary') else ''

        # 截断过长文本
        if content and len(content) > 2000:
            content = content[:2000] + '...'

        messages.append({
            'id': row['id'],
            'time': row['time_created'],
            'role': data.get('role', ''),
            'content': content.strip()
        })

    conn.close()
    return messages

if __name__ == '__main__':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    last_time = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    msgs = query_messages(last_time)
    print(json.dumps(msgs, ensure_ascii=False))
