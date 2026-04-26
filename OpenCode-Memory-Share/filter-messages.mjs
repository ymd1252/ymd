/**
 * 服务器端消息过滤与归纳脚本
 *
 * 功能：
 * 1. 过滤垃圾消息（系统提示词、AI回读历史等）
 * 2. 去重（相同username+content只保留最早一条）
 * 3. 超过100条时，将旧消息归纳为摘要，保留最新100条
 *
 * 用法: node filter-messages.mjs
 * cron: 每10分钟执行一次
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MESSAGES_FILE = path.join(__dirname, '对话记忆数据', 'messages.json');
const MAX_MESSAGES = 100;

// ============ 过滤规则 ============

function isGarbage(msg) {
    const c = (msg.content || '').trim();
    if (!c) return true;

    // 系统提示词
    if (c.startsWith('You MUST speak Chinese only!')) return true;
    if (c.startsWith('You are an AI coding assistant')) return true;
    if (c.startsWith('Read the file ')) return true;
    if (c.includes('.memory-history.txt')) return true;

    // AI回读历史的各种格式
    if (msg.username === 'assistant') {
        if (c.startsWith('以下是保存的对话历史')) return true;
        if (c.startsWith('已读取到以下对话历史')) return true;
        if (c.startsWith('这是一份简短的历史对话')) return true;
        if (c.startsWith('以下是') && c.includes('对话记录')) return true;
        if (c.includes('历史对话记录') && c.includes('---')) return true;
        if (c.startsWith('以下是之前回复的')) return true;
    }

    return false;
}

// ============ 去重 ============

function deduplicate(messages) {
    const seen = new Set();
    const result = [];
    for (const msg of messages) {
        const key = msg.username + '||' + msg.content;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(msg);
    }
    return result;
}

// ============ 归纳旧消息 ============

function summarizeOldMessages(messages) {
    // 将消息按对话轮次分组（连续的user+assistant为一轮）
    const rounds = [];
    let currentRound = [];

    for (const msg of messages) {
        if (msg.username === '用户' || msg.username === 'user') {
            if (currentRound.length > 0) {
                rounds.push(currentRound);
            }
            currentRound = [msg];
        } else {
            currentRound.push(msg);
        }
    }
    if (currentRound.length > 0) {
        rounds.push(currentRound);
    }

    // 生成摘要
    const summaryParts = [];
    for (const round of rounds) {
        const userMsg = round.find(m => m.username === '用户' || m.username === 'user');
        const aiMsg = round.find(m => m.username === 'assistant');
        const time = (userMsg || round[0]).time;
        const userContent = userMsg ? userMsg.content.substring(0, 50) : '(无用户消息)';
        const aiContent = aiMsg ? aiMsg.content.substring(0, 50) : '(无AI回复)';
        summaryParts.push(`[${time}] 用户: ${userContent} | AI: ${aiContent}`);
    }

    return {
        username: 'system',
        content: `📋 早期对话摘要（共${rounds.length}轮）:\n` + summaryParts.join('\n'),
        image: '',
        nickname: '系统摘要',
        avatar: '',
        time: rounds[0] ? (rounds[0][0]).time : ''
    };
}

// ============ 主流程 ============

function main() {
    if (!fs.existsSync(MESSAGES_FILE)) {
        console.log('messages.json 不存在');
        return;
    }

    const original = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'));
    console.log(`原始消息数: ${original.length}`);

    // Step 1: 过滤垃圾
    let cleaned = original.filter(m => !isGarbage(m));
    console.log(`过滤垃圾后: ${cleaned.length} (删除 ${original.length - cleaned.length} 条)`);

    // Step 2: 去重
    const beforeDedup = cleaned.length;
    cleaned = deduplicate(cleaned);
    console.log(`去重后: ${cleaned.length} (删除 ${beforeDedup - cleaned.length} 条)`);

    // Step 3: 如果超过 MAX_MESSAGES，归纳旧消息
    if (cleaned.length > MAX_MESSAGES) {
        const keepCount = MAX_MESSAGES - 1; // 留1个位置给摘要
        const oldMessages = cleaned.slice(0, cleaned.length - keepCount);
        const newMessages = cleaned.slice(cleaned.length - keepCount);

        const summary = summarizeOldMessages(oldMessages);
        cleaned = [summary, ...newMessages];
        console.log(`归纳后: ${cleaned.length} (摘要 ${oldMessages.length} 条旧消息为1条摘要)`);
    }

    // 备份
    const backupFile = MESSAGES_FILE + '.bak';
    if (!fs.existsSync(backupFile) || fs.statSync(MESSAGES_FILE).size !== fs.statSync(backupFile).size) {
        fs.writeFileSync(backupFile, JSON.stringify(original, null, 2), 'utf-8');
        console.log('已备份原文件');
    }

    // 写入
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(cleaned, null, 2), 'utf-8');
    console.log(`\n最终消息数: ${cleaned.length}`);

    // 输出最后5条预览
    console.log('\n--- 最后5条 ---');
    cleaned.slice(-5).forEach((m, i) => {
        console.log(`${cleaned.length - 5 + i} | ${m.username} | ${m.time} | ${(m.content || '').substring(0, 60)}`);
    });
}

main();
