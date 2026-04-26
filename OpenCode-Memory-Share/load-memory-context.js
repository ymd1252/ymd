#!/usr/bin/env node
/**
 * Memory Sync - 华为云MCP消息同步
 * 功能：加载历史 + 同步新消息
 * 
 * 用法：
 *   node load-memory-context.js --load [条数]   加载历史消息（默认5条）
 *   node load-memory-context.js --sync user <内容>   同步用户消息
 *   node load-memory-context.js --sync assistant <内容>   同步AI回复
 */

const http = require('http');
const fs = require('fs');
const readline = require('readline');

const SERVER_URL = 'http://115.120.248.67:3100';
const CONTEXT_FILE = 'C:\\Users\\12527\\.config\\opencode\\.memory-context.md';
const HISTORY_FILE = 'C:\\Users\\12527\\.config\\opencode\\.memory-history.txt';

let initialized = false;

function sendRequest(data) {
    return new Promise((resolve, reject) => {
        const reqDataStr = JSON.stringify(data);
        const urlParts = SERVER_URL.replace('http://', '').split(':');
        const options = {
            hostname: urlParts[0],
            port: parseInt(urlParts[1] || '3100'),
            path: '/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Content-Length': Buffer.byteLength(reqDataStr)
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                const lines = body.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            resolve(JSON.parse(line.slice(6)));
                            return;
                        } catch (e) {}
                    }
                }
                resolve(body);
            });
        });

        req.on('error', reject);
        req.write(reqDataStr);
        req.end();
    });
}

async function init() {
    if (initialized) return true;
    try {
        await sendRequest({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'memory-sync', version: '3.0.0' }
            }
        });

        await sendRequest({
            jsonrpc: '2.0',
            method: 'notifications/initialized',
            params: {}
        });

        initialized = true;
        return true;
    } catch (err) {
        console.error('[Memory] 连接失败:', err.message);
        return false;
    }
}

async function syncMessage(role, content) {
    const result = await sendRequest({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
            name: 'add_message',
            arguments: { role, content, image: '' }
        }
    });
    
    if (result && !result.error) {
        console.log('[Memory] 已同步: ' + role);
        return true;
    } else {
        console.error('[Memory] 同步失败');
        return false;
    }
}

async function loadHistory(limit = 5) {
    console.log('[Memory] 加载历史消息...');

    try {
        const result = await sendRequest({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
                name: 'get_latest_messages',
                arguments: { limit }
            }
        });

        if (result && result.result) {
            const messages = JSON.parse(result.result.content[0].text);

            if (messages.length === 0) {
                console.log('[Memory] 没有历史消息');
                fs.writeFileSync(CONTEXT_FILE, '# 没有历史消息\n', 'utf-8');
                fs.writeFileSync(HISTORY_FILE, '', 'utf-8');
                return [];
            }

            // Build display text
            let displayText = '历史对话:\n\n';
            messages.forEach((msg) => {
                const role = msg.username === 'zxt' ? '[用户]' : '[AI]';
                displayText += `${'='.repeat(40)}\n`;
                displayText += `${role} ${msg.nickname} - ${msg.time}\n`;
                displayText += `${'='.repeat(40)}\n`;
                displayText += `${msg.content}\n\n`;
            });

            // Save to files
            fs.writeFileSync(HISTORY_FILE, displayText, 'utf-8');

            // Create context
            let context = `# 对话历史\n\n`;
            context += `**消息数:** ${messages.length}\n\n`;
            context += displayText;
            context += `\n---\n`;
            context += `*请阅读以上历史对话，然后继续。注意：所有回复必须使用中文！*\n`;

            fs.writeFileSync(CONTEXT_FILE, context, 'utf-8');

            console.log(`[Memory] 已加载 ${messages.length} 条消息`);
            console.log(`[Memory] 历史保存到 ${HISTORY_FILE}`);

            // Display summary
            const total = messages.length;
            console.log('\n=== 对话历史加载完成 ===');
            console.log(`共 ${total} 条消息`);
            console.log('\n消息列表:');
            messages.forEach((msg, i) => {
                const role = msg.username === 'zxt' ? '用户' : 'AI';
                console.log(`  ${i + 1}. [${role}] ${msg.time}`);
                const preview = msg.content.substring(0, 60);
                console.log(`     ${preview}${msg.content.length > 60 ? '...' : ''}`);
            });
            console.log('\n=== 历史结束 ===\n');

            return messages;
        } else {
            console.error('[Memory] 获取消息失败');
            fs.writeFileSync(CONTEXT_FILE, '# 获取消息失败\n', 'utf-8');
            fs.writeFileSync(HISTORY_FILE, '', 'utf-8');
            return [];
        }

    } catch (err) {
        console.error('[Memory] 错误:', err.message);
        fs.writeFileSync(CONTEXT_FILE, '# 加载失败\n', 'utf-8');
        fs.writeFileSync(HISTORY_FILE, '', 'utf-8');
        return [];
    }
}

// 主程序入口
async function main() {
    const args = process.argv.slice(2);

    // --load 模式：加载历史然后退出
    if (args[0] === '--load') {
        const limit = parseInt(args[1]) || 5;
        const connected = await init();
        if (connected) {
            await loadHistory(limit);
        }
        process.exit(0);
    }

    // --sync 模式：同步单条消息然后退出
    else if (args[0] === '--sync') {
        const role = args[1] || 'user';
        const content = args.slice(2).join(' ');

        if (!content) {
            console.error('用法: --sync <user|assistant> <内容>');
            process.exit(1);
        }

        const connected = await init();
        if (connected) {
            await syncMessage(role, content);
        }
        process.exit(0);
    }

    // 无参数模式：加载历史然后监听stdin（交互模式）
    else {
        console.log('[Memory] 华为云MCP同步 - 等待消息...');
        const connected = await init();

        if (connected) {
            await loadHistory(5);

            // 监听stdin进行消息同步
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
                terminal: false
            });

            rl.on('line', async (line) => {
                try {
                    const data = JSON.parse(line.trim());
                    if (data.type === 'user') {
                        await syncMessage('user', data.content);
                    } else if (data.type === 'assistant') {
                        await syncMessage('assistant', data.content);
                    }
                } catch (e) {
                    // 忽略解析错误
                }
            });
        } else {
            // 连接失败时不保持进程运行
            process.exit(1);
        }
    }
}

// 运行主程序
main();
