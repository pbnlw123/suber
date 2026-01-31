/**
 * 订阅管理系统 - Cloudflare Workers 完整版
 * 
 * 环境变量需求（通过 wrangler.toml 或 Workers 设置）：
 * - SUBSCRIPTION_KV: KV 命名空间绑定
 * - API_KEY: API 访问密钥（用于写操作）
 * - TELEGRAM_BOT_TOKEN: 可选，Telegram Bot Token
 * 
 * Cron 触发器配置（wrangler.toml）：
 * [triggers]
 * crons = ["0 8 * * *"]  # 每天 UTC 08:00 执行
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS头配置
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    try {
      // API路由处理
      if (path.startsWith('/api/')) {
        // 验证 API Key（除GET请求外）
        if (request.method !== 'GET') {
          const authHeader = request.headers.get('Authorization');
          if (authHeader !== `Bearer ${env.API_KEY}`) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
              status: 401, 
              headers 
            });
          }
        }

        // 路由分发
        if (path === '/api/subscriptions' && request.method === 'GET') {
          return handleListSubscriptions(env, headers);
        }
        
        if (path === '/api/subscriptions' && request.method === 'POST') {
          return handleCreateSubscription(request, env, headers);
        }
        
        if (path.match(/^\/api\/subscriptions\/[^/]+$/) && request.method === 'PUT') {
          const id = path.split('/').pop();
          return handleUpdateSubscription(id, request, env, headers);
        }
        
        if (path.match(/^\/api\/subscriptions\/[^/]+$/) && request.method === 'DELETE') {
          const id = path.split('/').pop();
          return handleDeleteSubscription(id, env, headers);
        }
        
        if (path === '/api/check' && request.method === 'GET') {
          await checkAndNotify(env);
          return new Response(JSON.stringify({ 
            success: true, 
            message: 'Check completed',
            timestamp: new Date().toISOString()
          }), { headers });
        }
        
        if (path === '/api/stats' && request.method === 'GET') {
          return handleGetStats(env, headers);
        }
        
        return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers });
      }

      // Telegram Webhook 回调处理
      if (path === '/telegram-webhook' && request.method === 'POST') {
        return handleTelegramWebhook(request, env);
      }

      // 前端管理界面
      if (path === '/' || path === '/admin') {
        return new Response(getAdminHTML(), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers });

    } catch (error) {
      console.error('Error:', error);
      return new Response(JSON.stringify({ 
        error: error.message,
        stack: error.stack 
      }), { 
        status: 500, 
        headers 
      });
    }
  },

  // 定时任务触发器
  async scheduled(event, env, ctx) {
    console.log('Running scheduled check at:', new Date().toISOString());
    ctx.waitUntil(checkAndNotify(env));
  }
};

// ==================== 数据操作层 ====================

async function getAllSubscriptions(env) {
  const list = await env.SUBSCRIPTION_KV.list();
  const subscriptions = [];
  
  for (const key of list.keys) {
    try {
      const value = await env.SUBSCRIPTION_KV.get(key.name);
      if (value) {
        const sub = JSON.parse(value);
        sub.daysUntilExpiry = calculateDaysUntil(sub.renewalDate);
        subscriptions.push(sub);
      }
    } catch (e) {
      console.error(`Error parsing subscription ${key.name}:`, e);
    }
  }
  
  return subscriptions.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
}

async function getSubscription(env, id) {
  const value = await env.SUBSCRIPTION_KV.get(id);
  return value ? JSON.parse(value) : null;
}

async function saveSubscription(env, subscription) {
  await env.SUBSCRIPTION_KV.put(subscription.id, JSON.stringify(subscription));
}

async function deleteSub(env, id) {
  await env.SUBSCRIPTION_KV.delete(id);
}

// ==================== API 处理函数 ====================

async function handleListSubscriptions(env, headers) {
  const subs = await getAllSubscriptions(env);
  return new Response(JSON.stringify(subs), { headers });
}

async function handleCreateSubscription(request, env, headers) {
  const data = await request.json();
  
  // 数据验证
  if (!data.name || !data.renewalDate) {
    return new Response(JSON.stringify({ error: 'Name and renewalDate are required' }), { 
      status: 400, 
      headers 
    });
  }

  const id = crypto.randomUUID();
  const subscription = {
    id,
    name: data.name.trim(),
    cost: parseFloat(data.cost) || 0,
    currency: data.currency || 'CNY',
    period: data.period || 'monthly',
    renewalDate: data.renewalDate,
    category: data.category || 'other',
    notes: data.notes || '',
    notifyDays: Array.isArray(data.notifyDays) ? data.notifyDays : [7, 3, 1],
    telegramChatId: data.telegramChatId || '',
    webhookUrl: data.webhookUrl || '',
    createdAt: new Date().toISOString(),
    lastNotified: null,
    updatedAt: new Date().toISOString()
  };

  await saveSubscription(env, subscription);
  
  // 计算剩余天数用于返回
  subscription.daysUntilExpiry = calculateDaysUntil(subscription.renewalDate);
  
  return new Response(JSON.stringify(subscription), { headers, status: 201 });
}

async function handleUpdateSubscription(id, request, env, headers) {
  const existing = await getSubscription(env, id);
  if (!existing) {
    return new Response(JSON.stringify({ error: 'Subscription not found' }), { 
      status: 404, 
      headers 
    });
  }

  const data = await request.json();
  const updated = { 
    ...existing, 
    ...data, 
    id,
    updatedAt: new Date().toISOString()
  };
  
  // 确保 notifyDays 是数组
  if (data.notifyDays && !Array.isArray(data.notifyDays)) {
    updated.notifyDays = [7, 3, 1];
  }
  
  await saveSubscription(env, updated);
  updated.daysUntilExpiry = calculateDaysUntil(updated.renewalDate);
  
  return new Response(JSON.stringify(updated), { headers });
}

async function handleDeleteSubscription(id, env, headers) {
  const existing = await getSubscription(env, id);
  if (!existing) {
    return new Response(JSON.stringify({ error: 'Subscription not found' }), { 
      status: 404, 
      headers 
    });
  }
  
  await deleteSub(env, id);
  return new Response(JSON.stringify({ success: true, message: 'Deleted successfully' }), { headers });
}

async function handleGetStats(env, headers) {
  const subs = await getAllSubscriptions(env);
  
  const stats = {
    total: subs.length,
    monthlyCost: 0,
    yearlyCost: 0,
    expiringSoon: 0,
    expired: 0,
    byCategory: {}
  };

  subs.forEach(sub => {
    // 计算成本（统一转换为月度）
    let monthlyCost = 0;
    if (sub.period === 'monthly') monthlyCost = sub.cost;
    else if (sub.period === 'yearly') monthlyCost = sub.cost / 12;
    else if (sub.period === 'quarterly') monthlyCost = sub.cost / 3;
    
    stats.monthlyCost += monthlyCost;
    stats.yearlyCost += monthlyCost * 12;
    
    // 状态统计
    if (sub.daysUntilExpiry < 0) stats.expired++;
    else if (sub.daysUntilExpiry <= 7) stats.expiringSoon++;
    
    // 分类统计
    if (!stats.byCategory[sub.category]) {
      stats.byCategory[sub.category] = { count: 0, cost: 0 };
    }
    stats.byCategory[sub.category].count++;
    stats.byCategory[sub.category].cost += monthlyCost;
  });

  stats.monthlyCost = parseFloat(stats.monthlyCost.toFixed(2));
  stats.yearlyCost = parseFloat(stats.yearlyCost.toFixed(2));
  
  return new Response(JSON.stringify(stats), { headers });
}

// ==================== 通知系统 ====================

async function checkAndNotify(env) {
  const subs = await getAllSubscriptions(env);
  const today = new Date().toISOString().split('T')[0];
  let notifiedCount = 0;

  for (const sub of subs) {
    const daysLeft = sub.daysUntilExpiry;
    
    // 检查是否需要提醒：在提醒列表中且今天未通知过且未过期（或当天）
    if (sub.notifyDays.includes(daysLeft) && sub.lastNotified !== today) {
      try {
        await sendNotification(sub, daysLeft, env);
        
        // 更新最后通知时间
        sub.lastNotified = today;
        await saveSubscription(env, sub);
        notifiedCount++;
        
        console.log(`Notified: ${sub.name} (${daysLeft} days left)`);
      } catch (error) {
        console.error(`Failed to notify ${sub.name}:`, error);
      }
    }
    
    // 过期当天特别提醒
    if (daysLeft === 0 && sub.lastNotified !== today) {
      try {
        await sendNotification(sub, 0, env, true);
        sub.lastNotified = today;
        await saveSubscription(env, sub);
        notifiedCount++;
      } catch (error) {
        console.error(`Failed to send expiry notification for ${sub.name}:`, error);
      }
    }
  }
  
  return { checked: subs.length, notified: notifiedCount };
}

async function sendNotification(sub, daysLeft, env, isExpired = false) {
  // 生成通知消息
  const message = generateNotificationMessage(sub, daysLeft, isExpired);
  
  // 并发发送所有渠道
  const promises = [];
  
  // Telegram 通知
  if (sub.telegramChatId && env.TELEGRAM_BOT_TOKEN) {
    promises.push(sendTelegramMessage(sub.telegramChatId, message, env).catch(e => {
      console.error('Telegram send failed:', e);
    }));
  }
  
  // Webhook 通知
  if (sub.webhookUrl) {
    promises.push(sendWebhook(sub.webhookUrl, {
      type: isExpired ? 'subscription_expired' : 'subscription_reminder',
      subscription: {
        id: sub.id,
        name: sub.name,
        cost: sub.cost,
        currency: sub.currency,
        renewalDate: sub.renewalDate,
        category: sub.category
      },
      daysLeft: daysLeft,
      isExpired: isExpired,
      message: message,
      timestamp: new Date().toISOString()
    }).catch(e => {
      console.error('Webhook send failed:', e);
    }));
  }
  
  await Promise.all(promises);
}

async function sendTelegramMessage(chatId, text, env) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram API error: ${error}`);
  }
  
  return response.json();
}

async function sendWebhook(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'User-Agent': 'Subscription-Manager/1.0'
    },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) {
    throw new Error(`Webhook returned ${response.status}`);
  }
  
  return response;
}

function generateNotificationMessage(sub, daysLeft, isExpired) {
  const renewalDate = new Date(sub.renewalDate).toLocaleDateString('zh-CN');
  
  if (isExpired) {
    return `🚨 *订阅已过期*

服务: *${sub.name}*
已于 *${renewalDate}* 过期
费用: ${sub.cost} ${sub.currency}/周期

请及时续费或取消订阅以避免额外费用。`;
  }
  
  const emoji = daysLeft <= 1 ? '⏰' : daysLeft <= 3 ? '⚠️' : '📅';
  const urgency = daysLeft <= 1 ? '*即将到期！*' : `还有 ${daysLeft} 天到期`;
  
  return `${emoji} *订阅提醒*

服务: *${sub.name}*
${urgency}
到期日: ${renewalDate}
费用: ${sub.cost} ${sub.currency}/${sub.period === 'monthly' ? '月' : sub.period === 'yearly' ? '年' : '季'}

${sub.notes ? `备注: ${sub.notes}` : ''}`;
}

// Telegram Webhook 处理（支持通过 Bot 交互）
async function handleTelegramWebhook(request, env) {
  const update = await request.json();
  
  if (update.message && update.message.text) {
    const chatId = update.message.chat.id;
    const text = update.message.text;
    
    // 简单的命令处理
    if (text === '/start') {
      await sendTelegramMessage(chatId, 
        '欢迎使用订阅管理机器人！\n\n' +
        '您的 Chat ID 是: `' + chatId + '`\n\n' +
        '请将此 ID 添加到订阅配置中以接收提醒。', 
        env
      );
    } else if (text === '/list') {
      // 这里可以实现通过 Telegram 查询列表的功能
      const subs = await getAllSubscriptions(env);
      if (subs.length === 0) {
        await sendTelegramMessage(chatId, '暂无任何订阅。', env);
      } else {
        let msg = '*您的订阅列表:*\n\n';
        subs.forEach((sub, idx) => {
          const icon = sub.daysUntilExpiry < 0 ? '🔴' : sub.daysUntilExpiry <= 7 ? '🟡' : '🟢';
          msg += `${idx + 1}. ${icon} ${sub.name} (${sub.daysUntilExpiry}天)\n`;
        });
        await sendTelegramMessage(chatId, msg, env);
      }
    }
  }
  
  return new Response('OK');
}

// ==================== 工具函数 ====================

function calculateDaysUntil(dateString) {
  const target = new Date(dateString);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = target - today;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

// ==================== 前端界面 ====================

function getAdminHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>订阅管理系统 - Subscription Manager</title>
    <style>
        :root {
            --primary: #667eea;
            --primary-dark: #764ba2;
            --danger: #e74c3c;
            --warning: #f39c12;
            --success: #27ae60;
            --bg: #f5f7fa;
            --card-bg: #ffffff;
            --text: #2c3e50;
            --text-secondary: #7f8c8d;
        }
        
        * { box-sizing: border-box; margin: 0; padding: 0; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
            min-height: 100vh;
            color: var(--text);
            line-height: 1.6;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        /* 头部样式 */
        .header {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            padding: 40px;
            border-radius: 24px;
            margin-bottom: 30px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.1);
            position: relative;
            overflow: hidden;
        }
        
        .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 5px;
            background: linear-gradient(90deg, var(--primary), var(--primary-dark));
        }
        
        h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            background: linear-gradient(135deg, var(--primary), var(--primary-dark));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .subtitle {
            color: var(--text-secondary);
            font-size: 1.1em;
        }
        
        /* 统计卡片 */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 20px;
            margin-top: 30px;
        }
        
        .stat-card {
            background: linear-gradient(135deg, var(--primary), var(--primary-dark));
            color: white;
            padding: 25px;
            border-radius: 16px;
            box-shadow: 0 10px 30px rgba(102, 126, 234, 0.3);
            transition: transform 0.3s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-5px);
        }
        
        .stat-label {
            font-size: 0.9em;
            opacity: 0.9;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .stat-value {
            font-size: 2.5em;
            font-weight: bold;
            margin-top: 5px;
        }
        
        /* 表单区域 */
        .form-section {
            background: var(--card-bg);
            padding: 40px;
            border-radius: 24px;
            margin-bottom: 30px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.08);
        }
        
        .section-title {
            font-size: 1.5em;
            margin-bottom: 25px;
            color: var(--text);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .form-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
        }
        
        .form-group {
            display: flex;
            flex-direction: column;
        }
        
        label {
            font-size: 0.9em;
            font-weight: 600;
            color: var(--text-secondary);
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        input, select, textarea {
            padding: 14px;
            border: 2px solid #e1e8ed;
            border-radius: 12px;
            font-size: 16px;
            transition: all 0.3s;
            font-family: inherit;
        }
        
        input:focus, select:focus, textarea:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        
        textarea {
            resize: vertical;
            min-height: 80px;
        }
        
        .checkbox-group {
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
            margin-top: 10px;
        }
        
        .checkbox-group label {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: normal;
            text-transform: none;
            cursor: pointer;
        }
        
        .btn {
            background: linear-gradient(135deg, var(--primary), var(--primary-dark));
            color: white;
            border: none;
            padding: 16px 32px;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            display: inline-flex;
            align-items: center;
            gap: 10px;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(102, 126, 234, 0.5);
        }
        
        .btn:active {
            transform: translateY(0);
        }
        
        /* 订阅列表 */
        .subscriptions-container {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 25px;
        }
        
        .sub-card {
            background: var(--card-bg);
            border-radius: 20px;
            padding: 30px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
            border: 1px solid #edf2f7;
        }
        
        .sub-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 5px;
            height: 100%;
            background: var(--success);
            transition: width 0.3s;
        }
        
        .sub-card:hover::before {
            width: 8px;
        }
        
        .sub-card.warning::before {
            background: var(--warning);
        }
        
        .sub-card.danger::before {
            background: var(--danger);
        }
        
        .sub-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.12);
        }
        
        .sub-header {
            display: flex;
            justify-content: space-between;
            align-items: start;
            margin-bottom: 15px;
        }
        
        .sub-name {
            font-size: 1.4em;
            font-weight: 700;
            color: var(--text);
            margin-bottom: 5px;
        }
        
        .sub-category {
            display: inline-block;
            padding: 4px 12px;
            background: #edf2f7;
            border-radius: 20px;
            font-size: 0.85em;
            color: var(--text-secondary);
            text-transform: capitalize;
        }
        
        .sub-cost {
            font-size: 1.8em;
            font-weight: bold;
            color: var(--primary);
            margin: 15px 0;
        }
        
        .sub-meta {
            color: var(--text-secondary);
            font-size: 0.95em;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .days-badge {
            display: inline-block;
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 0.9em;
            font-weight: 700;
            margin-top: 10px;
        }
        
        .days-safe {
            background: #d4edda;
            color: #155724;
        }
        
        .days-warning {
            background: #fff3cd;
            color: #856404;
        }
        
        .days-danger {
            background: #f8d7da;
            color: #721c24;
        }
        
        .actions {
            margin-top: 20px;
            display: flex;
            gap: 10px;
        }
        
        .btn-small {
            padding: 8px 16px;
            font-size: 14px;
            border-radius: 8px;
            cursor: pointer;
            border: none;
            transition: all 0.2s;
            font-weight: 600;
        }
        
        .btn-edit {
            background: #ebf8ff;
            color: #3182ce;
        }
        
        .btn-edit:hover {
            background: #bee3f8;
        }
        
        .btn-delete {
            background: #fed7d7;
            color: #c53030;
        }
        
        .btn-delete:hover {
            background: #feb2b2;
        }
        
        .empty-state {
            text-align: center;
            padding: 80px 20px;
            color: var(--text-secondary);
            background: rgba(255, 255, 255, 0.5);
            border-radius: 24px;
            border: 2px dashed #cbd5e0;
        }
        
        .empty-state-icon {
            font-size: 4em;
            margin-bottom: 20px;
            opacity: 0.5;
        }
        
        /* 模态框 */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(5px);
            z-index: 1000;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        
        .modal.active {
            display: flex;
        }
        
        .modal-content {
            background: white;
            padding: 40px;
            border-radius: 24px;
            max-width: 600px;
            width: 100%;
            max-height: 90vh;
            overflow-y: auto;
            animation: slideUp 0.3s ease;
        }
        
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(50px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 25px;
        }
        
        .close-btn {
            background: none;
            border: none;
            font-size: 1.5em;
            cursor: pointer;
            color: var(--text-secondary);
            padding: 5px;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            transition: all 0.2s;
        }
        
        .close-btn:hover {
            background: #f7fafc;
            color: var(--text);
        }
        
        /* 提示消息 */
        .toast {
            position: fixed;
            bottom: 30px;
            right: 30px;
            padding: 16px 24px;
            background: var(--text);
            color: white;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
            display: none;
            align-items: center;
            gap: 12px;
            z-index: 2000;
            animation: slideIn 0.3s ease;
        }
        
        .toast.show {
            display: flex;
        }
        
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        .toast.success { background: var(--success); }
        .toast.error { background: var(--danger); }
        
        /* 响应式 */
        @media (max-width: 768px) {
            .container { padding: 10px; }
            h1 { font-size: 1.8em; }
            .header { padding: 25px; }
            .form-section { padding: 25px; }
            .subscriptions-container { grid-template-columns: 1fr; }
            .stats-grid { grid-template-columns: repeat(2, 1fr); }
        }
        
        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 1s ease-in-out infinite;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- 头部 -->
        <div class="header">
            <h1>📊 订阅管理系统</h1>
            <p class="subtitle">轻松跟踪所有订阅服务，不再错过续费时间</p>
            <div class="stats-grid" id="stats">
                <div class="stat-card">
                    <div class="stat-label">总订阅数</div>
                    <div class="stat-value" id="stat-total">-</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">月度支出</div>
                    <div class="stat-value" id="stat-monthly">-</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">即将到期</div>
                    <div class="stat-value" id="stat-expiring">-</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">已过期</div>
                    <div class="stat-value" id="stat-expired">-</div>
                </div>
            </div>
        </div>

        <!-- 添加表单 -->
        <div class="form-section">
            <h2 class="section-title">➕ 添加新订阅</h2>
            <form id="subForm">
                <div class="form-grid">
                    <div class="form-group">
                        <label for="name">服务名称 *</label>
                        <input type="text" id="name" placeholder="例如：Netflix、ChatGPT Plus" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="category">分类</label>
                        <select id="category">
                            <option value="entertainment">🎬 娱乐</option>
                            <option value="software">💻 软件</option>
                            <option value="cloud">☁️ 云服务</option>
                            <option value="domain">🌐 域名/主机</option>
                            <option value="other">📦 其他</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="cost">费用</label>
                        <input type="number" id="cost" placeholder="0.00" step="0.01" min="0">
                    </div>
                    
                    <div class="form-group">
                        <label for="currency">货币</label>
                        <select id="currency">
                            <option value="CNY">CNY (¥) - 人民币</option>
                            <option value="USD">USD ($) - 美元</option>
                            <option value="EUR">EUR (€) - 欧元</option>
                            <option value="GBP">GBP (£) - 英镑</option>
                            <option value="JPY">JPY (¥) - 日元</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="period">计费周期</label>
                        <select id="period">
                            <option value="monthly">按月</option>
                            <option value="quarterly">按季</option>
                            <option value="yearly">按年</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="renewalDate">续费日期 *</label>
                        <input type="date" id="renewalDate" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="telegramChatId">Telegram Chat ID（可选）</label>
                        <input type="text" id="telegramChatId" placeholder="用于接收提醒通知">
                    </div>
                    
                    <div class="form-group">
                        <label for="webhookUrl">Webhook URL（可选）</label>
                        <input type="url" id="webhookUrl" placeholder="https://...">
                    </div>
                    
                    <div class="form-group" style="grid-column: 1 / -1;">
                        <label>提醒设置（到期前）</label>
                        <div class="checkbox-group">
                            <label><input type="checkbox" value="7" checked> 7天前</label>
                            <label><input type="checkbox" value="3" checked> 3天前</label>
                            <label><input type="checkbox" value="1" checked> 1天前</label>
                            <label><input type="checkbox" value="0"> 当天</label>
                        </div>
                    </div>
                    
                    <div class="form-group" style="grid-column: 1 / -1;">
                        <label for="notes">备注（可选）</label>
                        <textarea id="notes" placeholder="添加关于此订阅的额外信息..."></textarea>
                    </div>
                </div>
                
                <div style="margin-top: 25px;">
                    <button type="submit" class="btn">
                        <span id="submitText">保存订阅</span>
                    </button>
                </div>
            </form>
        </div>

        <!-- 订阅列表 -->
        <div class="form-section">
            <h2 class="section-title">📋 订阅列表</h2>
            <div id="subscriptions" class="subscriptions-container">
                <div class="loading-state" style="text-align: center; padding: 40px;">
                    <div class="loading"></div>
                    <p style="margin-top: 15px; color: var(--text-secondary);">加载中...</p>
                </div>
            </div>
        </div>
    </div>

    <!-- 编辑模态框 -->
    <div id="editModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2>✏️ 编辑订阅</h2>
                <button class="close-btn" onclick="closeEditModal()">×</button>
            </div>
            <form id="editForm">
                <input type="hidden" id="editId">
                <div class="form-grid">
                    <div class="form-group">
                        <label>服务名称</label>
                        <input type="text" id="editName" required>
                    </div>
                    <div class="form-group">
                        <label>分类</label>
                        <select id="editCategory">
                            <option value="entertainment">娱乐</option>
                            <option value="software">软件</option>
                            <option value="cloud">云服务</option>
                            <option value="domain">域名/主机</option>
                            <option value="other">其他</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>费用</label>
                        <input type="number" id="editCost" step="0.01">
                    </div>
                    <div class="form-group">
                        <label>货币</label>
                        <select id="editCurrency">
                            <option value="CNY">CNY</option>
                            <option value="USD">USD</option>
                            <option value="EUR">EUR</option>
                            <option value="GBP">GBP</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>续费日期</label>
                        <input type="date" id="editRenewalDate" required>
                    </div>
                    <div class="form-group">
                        <label>Telegram Chat ID</label>
                        <input type="text" id="editTelegramChatId">
                    </div>
                </div>
                <div style="margin-top: 25px; display: flex; gap: 10px;">
                    <button type="submit" class="btn">保存修改</button>
                    <button type="button" class="btn" style="background: #cbd5e0;" onclick="closeEditModal()">取消</button>
                </div>
            </form>
        </div>
    </div>

    <!-- Toast 提示 -->
    <div id="toast" class="toast">
        <span id="toastIcon">✓</span>
        <span id="toastMessage">操作成功</span>
    </div>

    <script>
        // API 配置
        const API_KEY = localStorage.getItem('sub_api_key') || '';
        let editingId = null;

        // 初始化
        document.addEventListener('DOMContentLoaded', () => {
            checkAuth();
            loadSubscriptions();
            loadStats();
            
            // 每分钟刷新
            setInterval(() => {
                loadSubscriptions();
                loadStats();
            }, 60000);
        });

        function checkAuth() {
            if (!API_KEY) {
                const key = prompt('请输入 API Key 以访问管理系统：');
                if (key) {
                    localStorage.setItem('sub_api_key', key);
                    location.reload();
                }
            }
        }

        function showToast(message, type = 'success') {
            const toast = document.getElementById('toast');
            const icon = document.getElementById('toastIcon');
            const msg = document.getElementById('toastMessage');
            
            toast.className = 'toast show ' + type;
            icon.textContent = type === 'success' ? '✓' : '✕';
            msg.textContent = message;
            
            setTimeout(() => {
                toast.classList.remove('show');
            }, 3000);
        }

        async function loadStats() {
            try {
                const res = await fetch('/api/stats');
                const stats = await res.json();
                
                document.getElementById('stat-total').textContent = stats.total;
                document.getElementById('stat-monthly').textContent = '¥' + stats.monthlyCost.toFixed(0);
                document.getElementById('stat-expiring').textContent = stats.expiringSoon;
                document.getElementById('stat-expired').textContent = stats.expired;
                
                // 根据状态改变颜色
                document.getElementById('stat-expiring').style.color = stats.expiringSoon > 0 ? '#f39c12' : '';
                document.getElementById('stat-expired').style.color = stats.expired > 0 ? '#e74c3c' : '';
            } catch (e) {
                console.error('Failed to load stats:', e);
            }
        }

        async function loadSubscriptions() {
            try {
                const res = await fetch('/api/subscriptions');
                if (!res.ok) throw new Error('Failed to fetch');
                const subs = await res.json();
                renderSubscriptions(subs);
            } catch (e) {
                console.error('Error loading subscriptions:', e);
                document.getElementById('subscriptions').innerHTML = 
                    '<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3>加载失败</h3><p>请检查网络连接或 API Key 是否正确</p></div>';
            }
        }

        function renderSubscriptions(subs) {
            const container = document.getElementById('subscriptions');
            
            if (subs.length === 0) {
                container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><h3>暂无订阅</h3><p>添加您的第一个订阅开始追踪</p></div>';
                return;
            }
            
            container.innerHTML = subs.map(sub => {
                let cardClass = '';
                let badgeClass = 'days-safe';
                let statusText = '';
                
                if (sub.daysUntilExpiry < 0) {
                    cardClass = 'danger';
                    badgeClass = 'days-danger';
                    statusText = '已过期 ' + Math.abs(sub.daysUntilExpiry) + ' 天';
                } else if (sub.daysUntilExpiry === 0) {
                    cardClass = 'danger';
                    badgeClass = 'days-danger';
                    statusText = '今天到期';
                } else if (sub.daysUntilExpiry <= 7) {
                    cardClass = 'warning';
                    badgeClass = 'days-warning';
                    statusText = sub.daysUntilExpiry + ' 天后到期';
                } else {
                    statusText = sub.daysUntilExpiry + ' 天后到期';
                }
                
                const periodText = {
                    monthly: '月',
                    yearly: '年',
                    quarterly: '季'
                }[sub.period] || sub.period;
                
                return \`
                    <div class="sub-card \${cardClass}">
                        <div class="sub-header">
                            <div>
                                <div class="sub-name">\${sub.name}</div>
                                <span class="sub-category">\${getCategoryName(sub.category)}</span>
                            </div>
                        </div>
                        
                        <div class="sub-cost">
                            \${sub.cost} \${sub.currency}/\${periodText}
                        </div>
                        
                        <div class="sub-meta">
                            📅 续费日期: \${sub.renewalDate}
                        </div>
                        
                        <div class="days-badge \${badgeClass}">
                            \${statusText}
                        </div>
                        
                        \${sub.notes ? '<div class="sub-meta" style="margin-top: 10px; font-style: italic;">📝 ' + sub.notes + '</div>' : ''}
                        
                        <div class="actions">
                            <button class="btn-small btn-edit" onclick='openEditModal(\${JSON.stringify(sub)})'>编辑</button>
                            <button class="btn-small btn-delete" onclick="deleteSubscription('\${sub.id}')">删除</button>
                        </div>
                    </div>
                \`;
            }).join('');
        }

        function getCategoryName(cat) {
            const map = {
                entertainment: '娱乐',
                software: '软件',
                cloud: '云服务',
                domain: '域名/主机',
                other: '其他'
            };
            return map[cat] || cat;
        }

        // 添加订阅
        document.getElementById('subForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const notifyDays = Array.from(document.querySelectorAll('#subForm input[type="checkbox"]:checked'))
                .map(cb => parseInt(cb.value));
            
            const data = {
                name: document.getElementById('name').value,
                cost: parseFloat(document.getElementById('cost').value) || 0,
                currency: document.getElementById('currency').value,
                period: document.getElementById('period').value,
                renewalDate: document.getElementById('renewalDate').value,
                category: document.getElementById('category').value,
                notes: document.getElementById('notes').value,
                telegramChatId: document.getElementById('telegramChatId').value,
                webhookUrl: document.getElementById('webhookUrl').value,
                notifyDays: notifyDays
            };
            
            try {
                const res = await fetch('/api/subscriptions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + API_KEY
                    },
                    body: JSON.stringify(data)
                });
                
                if (!res.ok) throw new Error('Save failed');
                
                showToast('订阅添加成功');
                e.target.reset();
                loadSubscriptions();
                loadStats();
            } catch (e) {
                showToast('添加失败: ' + e.message, 'error');
            }
        });

        // 删除订阅
        async function deleteSubscription(id) {
            if (!confirm('确定要删除这个订阅吗？此操作不可撤销。')) return;
            
            try {
                const res = await fetch('/api/subscriptions/' + id, {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + API_KEY }
                });
                
                if (!res.ok) throw new Error('Delete failed');
                
                showToast('删除成功');
                loadSubscriptions();
                loadStats();
            } catch (e) {
                showToast('删除失败: ' + e.message, 'error');
            }
        }

        // 编辑功能
        function openEditModal(sub) {
            editingId = sub.id;
            document.getElementById('editId').value = sub.id;
            document.getElementById('editName').value = sub.name;
            document.getElementById('editCategory').value = sub.category;
            document.getElementById('editCost').value = sub.cost;
            document.getElementById('editCurrency').value = sub.currency;
            document.getElementById('editRenewalDate').value = sub.renewalDate;
            document.getElementById('editTelegramChatId').value = sub.telegramChatId || '';
            
            document.getElementById('editModal').classList.add('active');
        }

        function closeEditModal() {
            document.getElementById('editModal').classList.remove('active');
            editingId = null;
        }

        document.getElementById('editForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const data = {
                name: document.getElementById('editName').value,
                category: document.getElementById('editCategory').value,
                cost: parseFloat(document.getElementById('editCost').value) || 0,
                currency: document.getElementById('editCurrency').value,
                renewalDate: document.getElementById('editRenewalDate').value,
                telegramChatId: document.getElementById('editTelegramChatId').value
            };
            
            try {
                const res = await fetch('/api/subscriptions/' + editingId, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + API_KEY
                    },
                    body: JSON.stringify(data)
                });
                
                if (!res.ok) throw new Error('Update failed');
                
                showToast('修改成功');
                closeEditModal();
                loadSubscriptions();
                loadStats();
            } catch (e) {
                showToast('修改失败: ' + e.message, 'error');
            }
        });

        // 点击模态框外部关闭
        document.getElementById('editModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('editModal')) {
                closeEditModal();
            }
        });
    </script>
</body>
</html>`;
}
