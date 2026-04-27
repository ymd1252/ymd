#!/usr/bin/env node
/**
 * 对话记忆同步守护进程 v4.0
 * 极简设计：每20秒轮询一次，所有消息直接上传，服务器去重
 *
 * 用法: node memory-watcher.js
 * 后台运行: start "memory-watcher" /MIN node memory-watcher.js
 */

const http = require('http');
const fs = require('fs');
const child_process = require('child_process');

const SERVER_URL = 'http://115.120.248.67:3100';
const PY_QUERY = 'C:/Users/admin/.config/opencode/db-query.py';
const STATE_FILE = 'C:/Users/admin/.config/opencode/.memory-sync-state.json';
const LOCK_FILE = 'C:/Users/admin/.config/opencode/.memory-watcher.lock';
const LOG_FILE = 'C:/Users/admin/.config/opencode/watcher.log';
const ERR_LOG_FILE = 'C:/Users/admin/.config/opencode/watcher-err.log';
const POLL_INTERVAL = 20000;  // 每20秒同步一次
const TIMEOUT_MS = 10000;

// 禁用代理
process.env.HTTP_PROXY = '';
process.env.HTTPS_PROXY = '';
process.env.http_proxy = '';
process.env.https_proxy = '';

// ============ 单实例锁 ============
var lockFd = null;
function acquireLock() {
    try {
        try { lockFd = fs.openSync(LOCK_FILE, 'wx'); } catch (e) {
            if (e.code === 'EEXIST') {
                var oldPid = 0;
                try { oldPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf-8').trim(), 10); } catch (ex) {}
                if (oldPid && oldPid !== process.pid) {
                    try { process.kill(oldPid, 0); log('另一个 watcher (PID:' + oldPid + ') 运行中，退出'); process.exit(0); } catch (ex) {
                        try { fs.unlinkSync(LOCK_FILE); } catch (ex2) {}
                        try { lockFd = fs.openSync(LOCK_FILE, 'wx'); } catch (ex2) { log('无法获取锁，退出'); process.exit(0); }
                    }
                }
            } else { log('无法获取锁: ' + e.message + '，退出'); process.exit(0); }
        }
        fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf-8');
    } catch (e) { log('获取锁异常: ' + e.message); }
}
function releaseLock() {
    try { if (lockFd) fs.closeSync(lockFd); if (fs.existsSync(LOCK_FILE)) { if (fs.readFileSync(LOCK_FILE,'utf-8').trim() == process.pid) fs.unlinkSync(LOCK_FILE); } } catch (e) {}
}

// ============ 日志 ============
function log(msg) {
    var line = '[' + new Date().toLocaleString('zh-CN') + '] ' + msg;
    console.log(line);
    try { fs.appendFileSync(LOG_FILE, line + '\n', 'utf-8'); } catch (e) {}
}
function logError(msg) {
    var line = '[' + new Date().toLocaleString('zh-CN') + '] ERROR: ' + msg;
    console.error(line);
    try { fs.appendFileSync(ERR_LOG_FILE, line + '\n', 'utf-8'); } catch (e) {}
}

// ============ 同步状态 ============
var lastSyncedTime = 0;

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            var s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
            lastSyncedTime = s.lastSyncedTime || 0;
        }
    } catch (e) {}
}
function saveState() {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify({ lastSyncedTime: lastSyncedTime, updatedAt: new Date().toISOString() }), 'utf-8'); } catch (e) {}
}

// ============ MCP 通信 ============
function parseMcpResponse(body) {
    var lines = body.split('\n');
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('data: ')) { try { return JSON.parse(lines[i].slice(6)); } catch (e) {} }
    }
    try { return JSON.parse(body); } catch (e) { return null; }
}

function sendRequest(data) {
    return new Promise(function(resolve, reject) {
        var str = JSON.stringify(data);
        var parts = SERVER_URL.replace('http://', '').split(':');
        var req = http.request({
            hostname: parts[0], port: parseInt(parts[1] || '3100'), path: '/', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(str) },
            timeout: TIMEOUT_MS
        }, function(res) {
            var body = '';
            res.on('data', function(c) { body += c; });
            res.on('end', function() {
                var parsed = parseMcpResponse(body);
                if (parsed && !parsed.error) resolve(parsed); else reject(new Error((parsed && parsed.error && parsed.error.message) || '请求失败'));
            });
        });
        req.on('timeout', function() { req.destroy(); reject(new Error('超时')); });
        req.on('error', reject);
        req.write(str);
        req.end();
    });
}

var mcpReady = false;
async function ensureMcp() {
    if (mcpReady) return;
    await sendRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'memory-watcher', version: '4.0.0' } } });
    mcpReady = true;
}

async function uploadMessage(role, content) {
    try {
        await ensureMcp();
        await sendRequest({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: 'add_message', arguments: { role: role, content: content, image: '' } } });
        return true;
    } catch (err) {
        mcpReady = false;
        logError('上传失败: ' + err.message);
        return false;
    }
}

// ============ 查询数据库 ============
function queryNewMessages() {
    try {
        var stdout = child_process.execSync('python "' + PY_QUERY + '" ' + lastSyncedTime, { encoding: 'utf-8', timeout: 10000, windowsHide: true });
        var result = JSON.parse(stdout.trim());
        return Array.isArray(result) ? result : [];
    } catch (err) {
        logError('查询失败: ' + err.message);
        return [];
    }
}

// ============ 同步一轮 ============
var syncing = false;

async function sync() {
    if (syncing) return;
    syncing = true;

    try {
        var messages = queryNewMessages();
        if (messages.length === 0) return;

        // 首次运行时倒序转正序
        if (lastSyncedTime === 0) messages.reverse();

        var count = 0;
        for (var i = 0; i < messages.length; i++) {
            var msg = messages[i];
            // 跳过已处理的
            if (lastSyncedTime > 0 && msg.time <= lastSyncedTime) continue;

            // 空内容不上传（如 assistant 只有 tool call），但推进时间避免卡住
            if (!msg.content || msg.content.trim() === '') {
                lastSyncedTime = msg.time;
                saveState();
                continue;
            }

            var role = msg.role === 'user' ? 'user' : 'assistant';
            var ok = await uploadMessage(role, msg.content);
            if (ok) {
                log('同步 [' + role + '] ' + new Date(msg.time).toLocaleString('zh-CN') + ': ' + msg.content.substring(0, 50));
                lastSyncedTime = msg.time;
                saveState();
                count++;
            } else {
                break;  // 上传失败，停止本轮
            }
        }
        if (count > 0) log('本轮同步 ' + count + ' 条');
    } catch (err) {
        logError('同步错误: ' + err.message);
    } finally {
        syncing = false;
    }
}

// ============ 主入口 ============
async function main() {
    acquireLock();
    process.on('exit', releaseLock);

    log('对话记忆同步 v4.0 启动（每20秒同步，服务器去重）');

    loadState();
    log('上次同步: ' + (lastSyncedTime ? new Date(lastSyncedTime).toLocaleString('zh-CN') : '首次'));

    try { await ensureMcp(); log('MCP 连接成功'); } catch (err) {
        logError('MCP 连接失败: ' + err.message);
        mcpReady = false;
    }

    // 立即同步一次
    await sync();

    // 每20秒轮询
    setInterval(sync, POLL_INTERVAL);
    log('定时同步已启动，间隔 ' + POLL_INTERVAL + 'ms');

    process.on('SIGINT', function() { log('退出'); saveState(); process.exit(0); });
    process.on('SIGTERM', function() { saveState(); process.exit(0); });
}

main().catch(function(err) { logError('致命错误: ' + err.message); process.exit(1); });