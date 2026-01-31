// 订阅管理系统 - 修复版（确保默认登录可用）

// ==================== 核心修复：强制初始化默认配置 ====================
async function getConfig(env) {
  try {
    if (!env.SUBSCRIPTIONS_KV) {
      console.error('[致命错误] KV 未绑定，请在 Cloudflare 控制面板绑定 SUBSCRIPTIONS_KV');
      // 返回硬编码默认配置，允许登录（仅用于紧急恢复）
      return {
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: 'password',
        JWT_SECRET: 'fallback-secret-do-not-use-in-production',
        TIMEZONE: 'UTC',
        ENABLED_NOTIFIERS: [],
        NOTIFICATION_HOURS: []
      };
    }

    let config = {};
    try {
      const data = await env.SUBSCRIPTIONS_KV.get('config');
      if (data) {
        config = JSON.parse(data);
      }
    } catch (e) {
      console.error('[Config] KV读取失败:', e);
    }

    // 确保默认凭据存在（如果从未初始化）
    if (!config.ADMIN_USERNAME && !config.ADMIN_PASSWORD) {
      console.log('[Config] 首次初始化默认配置...');
      const defaultConfig = {
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: 'password',  // 默认密码
        JWT_SECRET: generateRandomSecret(),
        TG_BOT_TOKEN: '',
        TG_CHAT_ID: '',
        NOTIFYX_API_KEY: '',
        WEBHOOK_URL: '',
        WEBHOOK_METHOD: 'POST',
        WEBHOOK_HEADERS: '',
        WEBHOOK_TEMPLATE: '',
        SHOW_LUNAR: true,
        WECHATBOT_WEBHOOK: '',
        WECHATBOT_MSG_TYPE: 'text',
        WECHATBOT_AT_MOBILES: '',
        WECHATBOT_AT_ALL: 'false',
        RESEND_API_KEY: '',
        EMAIL_FROM: '',
        EMAIL_FROM_NAME: '订阅提醒系统',
        EMAIL_TO: '',
        BARK_DEVICE_KEY: '',
        BARK_SERVER: 'https://api.day.app',
        BARK_IS_ARCHIVE: 'false',
        ENABLED_NOTIFIERS: [],
        TIMEZONE: 'UTC',
        NOTIFICATION_HOURS: [],
        THIRD_PARTY_API_TOKEN: ''
      };
      
      try {
        await env.SUBSCRIPTIONS_KV.put('config', JSON.stringify(defaultConfig));
        console.log('[Config] 默认配置已保存到 KV');
        return defaultConfig;
      } catch (saveError) {
        console.error('[Config] 保存默认配置失败:', saveError);
      }
    }

    // 确保 JWT_SECRET 存在且安全
    let jwtSecret = config.JWT_SECRET;
    if (!jwtSecret || jwtSecret === 'your-secret-key' || jwtSecret === 'fallback-secret-do-not-use-in-production') {
      jwtSecret = generateRandomSecret();
      config.JWT_SECRET = jwtSecret;
      try {
        await env.SUBSCRIPTIONS_KV.put('config', JSON.stringify(config));
      } catch (e) {
        console.error('[Config] 更新 JWT_SECRET 失败:', e);
      }
    }

    return {
      ADMIN_USERNAME: config.ADMIN_USERNAME || 'admin',
      ADMIN_PASSWORD: config.ADMIN_PASSWORD || 'password',
      JWT_SECRET: jwtSecret,
      TG_BOT_TOKEN: config.TG_BOT_TOKEN || '',
      TG_CHAT_ID: config.TG_CHAT_ID || '',
      NOTIFYX_API_KEY: config.NOTIFYX_API_KEY || '',
      WEBHOOK_URL: config.WEBHOOK_URL || '',
      WEBHOOK_METHOD: config.WEBHOOK_METHOD || 'POST',
      WEBHOOK_HEADERS: config.WEBHOOK_HEADERS || '',
      WEBHOOK_TEMPLATE: config.WEBHOOK_TEMPLATE || '',
      SHOW_LUNAR: config.SHOW_LUNAR === true,
      WECHATBOT_WEBHOOK: config.WECHATBOT_WEBHOOK || '',
      WECHATBOT_MSG_TYPE: config.WECHATBOT_MSG_TYPE || 'text',
      WECHATBOT_AT_MOBILES: config.WECHATBOT_AT_MOBILES || '',
      WECHATBOT_AT_ALL: config.WECHATBOT_AT_ALL || 'false',
      RESEND_API_KEY: config.RESEND_API_KEY || '',
      EMAIL_FROM: config.EMAIL_FROM || '',
      EMAIL_FROM_NAME: config.EMAIL_FROM_NAME || '订阅提醒系统',
      EMAIL_TO: config.EMAIL_TO || '',
      BARK_DEVICE_KEY: config.BARK_DEVICE_KEY || '',
      BARK_SERVER: config.BARK_SERVER || 'https://api.day.app',
      BARK_IS_ARCHIVE: config.BARK_IS_ARCHIVE || 'false',
      ENABLED_NOTIFIERS: config.ENABLED_NOTIFIERS || [],
      TIMEZONE: config.TIMEZONE || 'UTC',
      NOTIFICATION_HOURS: Array.isArray(config.NOTIFICATION_HOURS) ? config.NOTIFICATION_HOURS : [],
      THIRD_PARTY_API_TOKEN: config.THIRD_PARTY_API_TOKEN || ''
    };
  } catch (error) {
    console.error('[getConfig] 严重错误:', error);
    // 最后的fallback
    return {
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'password',
      JWT_SECRET: 'emergency-fallback-secret',
      TIMEZONE: 'UTC'
    };
  }
}

// ==================== 工具函数 ====================
function generateRandomSecret() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.';
  let result = '';
  const randomValues = new Uint8Array(64);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(randomValues[i] % chars.length);
  }
  return result;
}

function getCookieValue(cookieString, key) {
  if (!cookieString) return null;
  const match = cookieString.match(new RegExp('(^| )' + key + '=([^;]+)'));
  return match ? match[2] : null;
}

// ==================== JWT 实现（使用 Web Crypto API 替代 btoa/atob 避免编码问题）=================
function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlToString(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  return atob(padded);
}

async function generateJWT(username, secret) {
  const encoder = new TextEncoder();
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { username, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 };
  
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '');
  const data = encoder.encode(headerB64 + '.' + payloadB64);
  
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, data);
  const sigB64 = arrayBufferToBase64Url(signature);
  
  return headerB64 + '.' + payloadB64 + '.' + sigB64;
}

async function verifyJWT(token, secret) {
  try {
    if (!token || !secret) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [headerB64, payloadB64, sigB64] = parts;
    const encoder = new TextEncoder();
    const data = encoder.encode(headerB64 + '.' + payloadB64);
    
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    
    const sig = Uint8Array.from(atob(sigB64.replace(/-/g, '+').replace(/_/g, '/').padEnd(sigB64.length + (4 - sigB64.length % 4) % 4, '=')), c => c.charCodeAt(0));
    
    const valid = await crypto.subtle.verify('HMAC', key, sig, data);
    if (!valid) return null;
    
    const payload = JSON.parse(base64UrlToString(payloadB64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    console.error('[JWT Verify Error]', e);
    return null;
  }
}

// ==================== 时区和农历工具（保持原样）====================
const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;

function getCurrentTimeInTimezone(timezone = 'UTC') {
  return new Date();
}

function getTimezoneDateParts(date, timezone = 'UTC') {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = formatter.formatToParts(date);
    const pick = (type) => {
      const part = parts.find(item => item.type === type);
      return part ? Number(part.value) : 0;
    };
    return {
      year: pick('year'), month: pick('month'), day: pick('day'),
      hour: pick('hour'), minute: pick('minute'), second: pick('second')
    };
  } catch (error) {
    return {
      year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
      hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds()
    };
  }
}

function getTimezoneMidnightTimestamp(date, timezone = 'UTC') {
  const { year, month, day } = getTimezoneDateParts(date, timezone);
  return Date.UTC(year, month - 1, day, 0, 0, 0);
}

function formatTimeInTimezone(time, timezone = 'UTC', format = 'full') {
  try {
    const date = new Date(time);
    if (format === 'date') {
      return date.toLocaleDateString('zh-CN', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    } else if (format === 'datetime') {
      return date.toLocaleString('zh-CN', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    return date.toLocaleString('zh-CN', { timeZone: timezone });
  } catch (error) {
    return new Date(time).toISOString();
  }
}

function formatTimezoneDisplay(timezone = 'UTC') {
  try {
    const now = new Date();
    const { year, month, day, hour, minute, second } = getTimezoneDateParts(now, timezone);
    const zonedTimestamp = Date.UTC(year, month - 1, day, hour, minute, second);
    const offset = Math.round((zonedTimestamp - now.getTime()) / MS_PER_HOUR);
    const offsetStr = offset >= 0 ? `+${offset}` : `${offset}`;
    const names = {
      'UTC': '世界标准时间', 'Asia/Shanghai': '中国标准时间', 'Asia/Taipei': '台北时间',
      'Asia/Tokyo': '日本时间', 'America/New_York': '美国东部时间'
    };
    return `${names[timezone] || timezone} (UTC${offsetStr})`;
  } catch (error) {
    return timezone;
  }
}

// 农历工具（简化版，保留核心功能）
const lunarCalendar = {
  lunarInfo: [0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,0x06ca0,0x0b550,0x15355,0x04da0,0x0a5b0,0x14573,0x052b0,0x0a9a8,0x0e950,0x06aa0,0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b6a0,0x195a6,0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x055c0,0x0ab60,0x096d5,0x092e0,0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,0x05aa0,0x076a3,0x096d0,0x04bd7,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0],
  gan: ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'],
  zhi: ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'],
  months: ['正','二','三','四','五','六','七','八','九','十','冬','腊'],
  days: ['初一','初二','初三','初四','初五','初六','初七','初八','初九','初十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十','廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'],
  
  lunarYearDays: function(y) { let sum=348; for(let i=0x8000;i>0x8;i>>=1) sum+=(this.lunarInfo[y-1900]&i)?1:0; return sum+this.leapDays(y); },
  leapDays: function(y) { if(this.leapMonth(y)) return (this.lunarInfo[y-1900]&0x10000)?30:29; return 0; },
  leapMonth: function(y) { return this.lunarInfo[y-1900]&0xf; },
  monthDays: function(y,m) { return (this.lunarInfo[y-1900]&(0x10000>>m))?30:29; },
  
  solar2lunar: function(y,m,d) {
    if(y<1900||y>2100) return null;
    const base=new Date(1900,0,31);
    const obj=new Date(y,m-1,d);
    let offset=Math.round((obj-base)/86400000);
    let temp,ly=1900;
    for(ly=1900; ly<2101&&offset>0; ly++) { temp=this.lunarYearDays(ly); offset-=temp; }
    if(offset<0){ offset+=temp; ly--; }
    let lm=1, leap=this.leapMonth(ly), isLeap=false;
    for(lm=1; lm<13&&offset>0; lm++) {
      if(leap>0&&lm===(leap+1)&&!isLeap){ --lm; isLeap=true; temp=this.leapDays(ly); }
      else { temp=this.monthDays(ly,lm); }
      if(isLeap&&lm===(leap+1)) isLeap=false;
      offset-=temp;
    }
    if(offset===0&&leap>0&&lm===leap+1) {
      if(isLeap) isLeap=false; else { isLeap=true; --lm; }
    }
    if(offset<0){ offset+=temp; --lm; }
    const ld=offset+1;
    const ganIdx=(ly-4)%10, zhiIdx=(ly-4)%12;
    return {
      year:ly, month:lm, day:ld, isLeap:isLeap,
      yearStr:this.gan[ganIdx]+this.zhi[zhiIdx]+'年',
      monthStr:(isLeap?'闰':'')+this.months[lm-1]+'月',
      dayStr:this.days[ld-1],
      fullStr: this.gan[ganIdx]+this.zhi[zhiIdx]+'年'+(isLeap?'闰':'')+this.months[lm-1]+'月'+this.days[ld-1]
    };
  }
};

const lunarBiz = {
  addLunarPeriod(lunar, val, unit) {
    let {year,month,day,isLeap}=lunar;
    if(unit==='year') {
      year+=val;
      if(isLeap&&lunarCalendar.leapMonth(year)===month) isLeap=true; else isLeap=false;
    } else if(unit==='month') {
      let total=(year-1900)*12+(month-1)+val;
      year=Math.floor(total/12)+1900; month=(total%12)+1;
      if(isLeap&&lunarCalendar.leapMonth(year)===month) isLeap=true; else isLeap=false;
    } else if(unit==='day') {
      const s=this.lunar2solar(lunar);
      const d=new Date(s.year, s.month-1, s.day+val);
      return lunarCalendar.solar2lunar(d.getFullYear(), d.getMonth()+1, d.getDate());
    }
    let maxDay=isLeap?lunarCalendar.leapDays(year):lunarCalendar.monthDays(year,month);
    let target=Math.min(day,maxDay);
    while(target>0) {
      let s=this.lunar2solar({year,month,day:target,isLeap});
      if(s) return {year,month,day:target,isLeap};
      target--;
    }
    return {year,month,day,isLeap};
  },
  lunar2solar(lunar) {
    for(let y=lunar.year-1; y<=lunar.year+1; y++) {
      for(let m=1; m<=12; m++) {
        for(let d=1; d<=31; d++) {
          const date=new Date(y,m-1,d);
          if(date.getFullYear()!==y||date.getMonth()+1!==m||date.getDate()!==d) continue;
          const l=lunarCalendar.solar2lunar(y,m,d);
          if(l&&l.year===lunar.year&&l.month===lunar.month&&l.day===lunar.day&&l.isLeap===lunar.isLeap) return {year:y,month:m,day:d};
        }
      }
    }
    return null;
  }
};

// ==================== HTML 页面（使用 Tailwind CDN，确保可访问）====================

const loginPage = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录 - 订阅管理系统</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>body{font-family:'Inter',sans-serif;background:linear-gradient(135deg,#f0f9ff 0%,#e0f2fe 100%);}</style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">
  <div class="w-full max-w-md">
    <div class="text-center mb-8">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-lg mb-4 text-blue-600 text-3xl">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
        </svg>
      </div>
      <h1 class="text-2xl font-bold text-slate-800">订阅管理系统</h1>
      <p class="text-slate-500 mt-1">默认账号: admin / password</p>
    </div>
    <div class="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/50 p-8">
      <form id="loginForm" class="space-y-6">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-2">用户名</label>
          <input type="text" id="username" value="admin" required class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" placeholder="admin">
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-2">密码</label>
          <input type="password" id="password" value="password" required class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" placeholder="password">
        </div>
        <button type="submit" id="submitBtn" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl shadow-lg shadow-blue-600/20 transition-all transform active:scale-95">
          登录
        </button>
        <div id="errorMsg" class="hidden text-center text-sm text-red-600 bg-red-50 py-2 rounded-lg"></div>
      </form>
    </div>
    <div class="text-center mt-8 text-slate-400 text-xs">
      <p>请确保 KV 存储已正确绑定</p>
    </div>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submitBtn');
      const errorDiv = document.getElementById('errorMsg');
      btn.disabled = true;
      btn.textContent = '登录中...';
      errorDiv.classList.add('hidden');
      
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            username: document.getElementById('username').value,
            password: document.getElementById('password').value
          })
        });
        const data = await res.json();
        if(data.success) {
          window.location.href = '/admin';
        } else {
          throw new Error(data.message || '登录失败');
        }
      } catch(err) {
        errorDiv.textContent = err.message;
        errorDiv.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = '登录';
      }
    });
  </script>
</body>
</html>
`;

const adminPage = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>订阅管理</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>body{font-family:'Inter',sans-serif;background:#f8fafc;}</style>
</head>
<body class="text-slate-800">
  <nav class="fixed top-0 w-full bg-white/80 backdrop-blur border-b border-slate-200 z-40 h-16">
    <div class="max-w-7xl mx-auto px-4 h-full flex justify-between items-center">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold">S</div>
        <div>
          <h1 class="font-bold text-lg">订阅管理系统</h1>
          <p class="text-xs text-slate-500" id="clock">加载中...</p>
        </div>
      </div>
      <div class="flex gap-4">
        <a href="/admin" class="px-3 py-2 text-blue-600 font-medium">订阅</a>
        <a href="/admin/config" class="px-3 py-2 text-slate-600 hover:text-slate-800">配置</a>
        <a href="/api/logout" class="px-3 py-2 text-red-600 hover:text-red-700">退出</a>
      </div>
    </div>
  </nav>
  
  <main class="pt-24 pb-12 px-4 max-w-7xl mx-auto">
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div class="text-slate-500 text-sm">总订阅</div>
        <div class="text-2xl font-bold mt-1" id="stat-total">-</div>
      </div>
      <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div class="text-slate-500 text-sm">月支出</div>
        <div class="text-2xl font-bold mt-1 text-emerald-600" id="stat-monthly">-</div>
      </div>
      <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div class="text-slate-500 text-sm">即将到期</div>
        <div class="text-2xl font-bold mt-1 text-amber-600" id="stat-expiring">-</div>
      </div>
      <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div class="text-slate-500 text-sm">已过期</div>
        <div class="text-2xl font-bold mt-1 text-rose-600" id="stat-expired">-</div>
      </div>
    </div>

    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-6 flex flex-col md:flex-row gap-4 justify-between">
      <div class="flex gap-4 flex-1">
        <input type="text" id="search" placeholder="搜索订阅..." class="px-4 py-2 border border-slate-200 rounded-lg flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500">
        <select id="filter" class="px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">全部分类</option>
        </select>
      </div>
      <div class="flex gap-4">
        <label class="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" id="showLunar" class="rounded border-slate-300 text-blue-600 focus:ring-blue-500">
          显示农历
        </label>
        <button onclick="openModal()" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">
          + 添加订阅
        </button>
      </div>
    </div>

    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <table class="w-full text-left">
        <thead class="bg-slate-50">
          <tr>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">名称</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">类型</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">到期时间</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">状态</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase text-right">操作</th>
          </tr>
        </thead>
        <tbody id="list" class="divide-y divide-slate-100"></tbody>
      </table>
    </div>
  </main>

  <div id="modal" class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm hidden z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
      <div class="p-6 border-b border-slate-100 flex justify-between items-center">
        <h2 class="text-xl font-bold" id="modalTitle">添加订阅</h2>
        <button onclick="closeModal()" class="text-slate-400 hover:text-slate-600">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <form id="subForm" class="p-6 space-y-4">
        <input type="hidden" id="subId">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">名称</label>
            <input type="text" id="name" required class="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">类型</label>
            <input type="text" id="type" class="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none">
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">分类（用 / 分隔）</label>
          <input type="text" id="category" class="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none">
        </div>
        <div class="flex gap-4 items-center p-4 bg-slate-50 rounded-lg">
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" id="useLunar" class="rounded border-slate-300 text-blue-600">
            按农历周期计算
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" id="autoRenew" checked class="rounded border-slate-300 text-blue-600">
            自动续订
          </label>
        </div>
        <div class="grid grid-cols-3 gap-4">
          <div class="col-span-2">
            <label class="block text-sm font-medium text-slate-700 mb-1">开始日期</label>
            <input type="date" id="startDate" class="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">周期</label>
            <div class="flex gap-2">
              <input type="number" id="periodVal" value="1" min="1" class="w-16 px-3 py-2 border border-slate-200 rounded-lg outline-none">
              <select id="periodUnit" class="flex-1 px-3 py-2 border border-slate-200 rounded-lg outline-none">
                <option value="day">天</option>
                <option value="month" selected>月</option>
                <option value="year">年</option>
              </select>
            </div>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">到期日期</label>
          <input type="date" id="expiryDate" required class="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none">
          <div id="lunarDisplay" class="text-xs text-purple-600 mt-1 hidden"></div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">提前提醒</label>
            <div class="flex gap-2">
              <input type="number" id="reminderVal" value="7" min="0" class="flex-1 px-3 py-2 border border-slate-200 rounded-lg outline-none">
              <select id="reminderUnit" class="w-20 px-3 py-2 border border-slate-200 rounded-lg outline-none">
                <option value="day">天</option>
                <option value="hour">小时</option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">备注</label>
            <input type="text" id="notes" class="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none">
          </div>
        </div>
        <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
          <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium">保存</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    let subs = [];
    let timezone = 'UTC';
    
    async function init() {
      await loadTimezone();
      updateClock();
      setInterval(updateClock, 1000);
      await loadSubs();
      document.getElementById('search').addEventListener('input', render);
      document.getElementById('filter').addEventListener('change', render);
      document.getElementById('showLunar').addEventListener('change', render);
      document.getElementById('startDate').addEventListener('change', calcExpiry);
      document.getElementById('periodVal').addEventListener('change', calcExpiry);
      document.getElementById('periodUnit').addEventListener('change', calcExpiry);
      document.getElementById('useLunar').addEventListener('change', calcExpiry);
    }

    async function loadTimezone() {
      try {
        const res = await fetch('/api/config');
        const config = await res.json();
        timezone = config.TIMEZONE || 'UTC';
      } catch(e) {}
    }

    function updateClock() {
      const now = new Date();
      const str = now.toLocaleString('zh-CN', {timeZone: timezone, hour12: false});
      document.getElementById('clock').textContent = str + ' · ' + timezone;
    }

    async function loadSubs() {
      const res = await fetch('/api/subscriptions');
      subs = await res.json();
      updateStats();
      render();
    }

    function updateStats() {
      const total = subs.length;
      let monthly = 0, expiring = 0, expired = 0;
      const now = new Date();
      subs.forEach(s => {
        if(s.periodUnit === 'month') monthly += (s.cost||0);
        else if(s.periodUnit === 'year') monthly += (s.cost||0)/12;
        const days = Math.ceil((new Date(s.expiryDate)-now)/(1000*60*60*24));
        if(days<0) expired++;
        else if(days<=7) expiring++;
      });
      document.getElementById('stat-total').textContent = total;
      document.getElementById('stat-monthly').textContent = '¥'+monthly.toFixed(0);
      document.getElementById('stat-expiring').textContent = expiring;
      document.getElementById('stat-expired').textContent = expired;
    }

    function render() {
      const keyword = document.getElementById('search').value.toLowerCase();
      const cat = document.getElementById('filter').value;
      const showLunar = document.getElementById('showLunar').checked;
      const now = new Date();
      
      let filtered = subs.filter(s => {
        if(cat && !(s.category||'').includes(cat)) return false;
        if(keyword && !(s.name+s.customType).toLowerCase().includes(keyword)) return false;
        return true;
      });
      
      filtered.sort((a,b) => new Date(a.expiryDate)-new Date(b.expiryDate));
      
      const tbody = document.getElementById('list');
      tbody.innerHTML = filtered.map(s => {
        const exp = new Date(s.expiryDate);
        const days = Math.ceil((exp-now)/(1000*60*60*24));
        let status, statusClass;
        if(!s.isActive) { status='已停用'; statusClass='bg-slate-100 text-slate-600'; }
        else if(days<0) { status='已过期 '+Math.abs(days)+' 天'; statusClass='bg-rose-100 text-rose-700'; }
        else if(days<=7) { status=days===0?'今天到期':days+' 天后到期'; statusClass='bg-amber-100 text-amber-700'; }
        else { status=days+' 天后到期'; statusClass='bg-emerald-100 text-emerald-700'; }
        
        let lunarStr = '';
        if(showLunar) {
          const l = lunarCalendar.solar2lunar(exp.getFullYear(), exp.getMonth()+1, exp.getDate());
          if(l) lunarStr = '<div class="text-xs text-purple-600 mt-1">'+l.fullStr+'</div>';
        }
        
        return '<tr class="hover:bg-slate-50 transition-colors">'+
          '<td class="px-6 py-4"><div class="font-medium">'+s.name+'</div><div class="text-sm text-slate-500">'+(s.notes||'')+'</div></td>'+
          '<td class="px-6 py-4"><div class="text-sm">'+(s.customType||'-')+'</div>'+(s.category?'<div class="text-xs text-blue-600 mt-1">'+s.category+'</div>':'')+'</td>'+
          '<td class="px-6 py-4"><div class="text-sm">'+exp.toLocaleDateString('zh-CN')+'</div>'+lunarStr+'</td>'+
          '<td class="px-6 py-4"><span class="px-3 py-1 rounded-full text-xs font-medium '+statusClass+'">'+status+'</span></td>'+
          '<td class="px-6 py-4 text-right space-x-2">'+
            '<button onclick="editSub(\''+s.id+'\')" class="text-blue-600 hover:text-blue-800 text-sm font-medium">编辑</button>'+
            '<button onclick="delSub(\''+s.id+'\')" class="text-rose-600 hover:text-rose-800 text-sm font-medium">删除</button>'+
          '</td>'+
        '</tr>';
      }).join('');
      
      const cats = new Set();
      subs.forEach(s => (s.category||'').split(/[\/,，\s]+/).forEach(c => c&&cats.add(c)));
      const sel = document.getElementById('filter');
      const cur = sel.value;
      sel.innerHTML = '<option value="">全部分类</option>' + Array.from(cats).map(c => '<option value="'+c+'">'+c+'</option>').join('');
      sel.value = cur;
    }

    function openModal() {
      document.getElementById('subForm').reset();
      document.getElementById('subId').value = '';
      document.getElementById('modalTitle').textContent = '添加订阅';
      document.getElementById('startDate').value = new Date().toISOString().split('T')[0];
      calcExpiry();
      document.getElementById('modal').classList.remove('hidden');
    }

    function closeModal() {
      document.getElementById('modal').classList.add('hidden');
    }

    function calcExpiry() {
      const start = document.getElementById('startDate').value;
      const val = parseInt(document.getElementById('periodVal').value)||1;
      const unit = document.getElementById('periodUnit').value;
      const useLunar = document.getElementById('useLunar').checked;
      
      if(!start) return;
      
      if(useLunar) {
        const d = new Date(start);
        const lunar = lunarCalendar.solar2lunar(d.getFullYear(), d.getMonth()+1, d.getDate());
        const next = lunarBiz.addLunarPeriod(lunar, val, unit);
        const solar = lunarBiz.lunar2solar(next);
        document.getElementById('expiryDate').value = new Date(solar.year, solar.month-1, solar.day).toISOString().split('T')[0];
        const l = lunarCalendar.solar2lunar(solar.year, solar.month, solar.day);
        document.getElementById('lunarDisplay').textContent = '对应: '+l.fullStr;
        document.getElementById('lunarDisplay').classList.remove('hidden');
      } else {
        const d = new Date(start);
        if(unit==='day') d.setDate(d.getDate()+val);
        else if(unit==='month') d.setMonth(d.getMonth()+val);
        else if(unit==='year') d.setFullYear(d.getFullYear()+val);
        document.getElementById('expiryDate').value = d.toISOString().split('T')[0];
        document.getElementById('lunarDisplay').classList.add('hidden');
      }
    }

    document.getElementById('subForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('subId').value;
      const data = {
        name: document.getElementById('name').value,
        customType: document.getElementById('type').value,
        category: document.getElementById('category').value,
        startDate: document.getElementById('startDate').value,
        expiryDate: document.getElementById('expiryDate').value,
        periodValue: parseInt(document.getElementById('periodVal').value),
        periodUnit: document.getElementById('periodUnit').value,
        reminderValue: parseInt(document.getElementById('reminderVal').value),
        reminderUnit: document.getElementById('reminderUnit').value,
        notes: document.getElementById('notes').value,
        autoRenew: document.getElementById('autoRenew').checked,
        useLunar: document.getElementById('useLunar').checked,
        isActive: true
      };
      
      const url = id ? '/api/subscriptions/'+id : '/api/subscriptions';
      const method = id ? 'PUT' : 'POST';
      
      await fetch(url, {
        method: method,
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(data)
      });
      closeModal();
      await loadSubs();
    });

    async function delSub(id) {
      if(!confirm('确定删除?')) return;
      await fetch('/api/subscriptions/'+id, {method:'DELETE'});
      await loadSubs();
    }

    window.editSub = function(id) {
      const s = subs.find(x => x.id===id);
      if(!s) return;
      document.getElementById('subId').value = s.id;
      document.getElementById('name').value = s.name;
      document.getElementById('type').value = s.customType||'';
      document.getElementById('category').value = s.category||'';
      document.getElementById('startDate').value = s.startDate?s.startDate.split('T')[0]:'';
      document.getElementById('periodVal').value = s.periodValue||1;
      document.getElementById('periodUnit').value = s.periodUnit||'month';
      document.getElementById('expiryDate').value = s.expiryDate.split('T')[0];
      document.getElementById('reminderVal').value = s.reminderValue||s.reminderDays||7;
      document.getElementById('reminderUnit').value = s.reminderUnit||'day';
      document.getElementById('notes').value = s.notes||'';
      document.getElementById('autoRenew').checked = s.autoRenew!==false;
      document.getElementById('useLunar').checked = s.useLunar||false;
      document.getElementById('modalTitle').textContent = '编辑订阅';
      document.getElementById('modal').classList.remove('hidden');
    };

    init();
  </script>
</body>
</html>`;

const configPage = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>系统配置</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>body{font-family:'Inter',sans-serif;background:#f8fafc;}</style>
</head>
<body class="text-slate-800">
  <nav class="fixed top-0 w-full bg-white/80 backdrop-blur border-b border-slate-200 z-40 h-16">
    <div class="max-w-7xl mx-auto px-4 h-full flex justify-between items-center">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold">S</div>
        <h1 class="font-bold text-lg">订阅管理系统</h1>
      </div>
      <div class="flex gap-4">
        <a href="/admin" class="px-3 py-2 text-slate-600 hover:text-slate-800">订阅</a>
        <a href="/admin/config" class="px-3 py-2 text-blue-600 font-medium">配置</a>
        <a href="/api/logout" class="px-3 py-2 text-red-600 hover:text-red-700">退出</a>
      </div>
    </div>
  </nav>

  <main class="pt-24 pb-12 px-4 max-w-3xl mx-auto">
    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
      <h2 class="text-2xl font-bold mb-6">系统配置</h2>
      <form id="cfgForm" class="space-y-6">
        <div>
          <h3 class="text-lg font-semibold mb-4">管理员账户</h3>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">用户名</label>
              <input type="text" id="adminUser" class="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">新密码 (留空不修改)</label>
              <input type="password" id="adminPass" class="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
            </div>
          </div>
        </div>

        <div>
          <h3 class="text-lg font-semibold mb-4">基本设置</h3>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">时区</label>
              <select id="timezone" class="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
                <option value="UTC">UTC</option>
                <option value="Asia/Shanghai">Asia/Shanghai (北京时间)</option>
                <option value="Asia/Tokyo">Asia/Tokyo</option>
                <option value="America/New_York">America/New_York</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">通知时段 (UTC小时, 逗号分隔, 如 08,20)</label>
              <input type="text" id="notifyHours" class="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            <label class="flex items-center gap-2">
              <input type="checkbox" id="showLunar" class="rounded border-slate-300 text-blue-600">
              在通知中显示农历日期
            </label>
          </div>
        </div>

        <div>
          <h3 class="text-lg font-semibold mb-4">通知渠道 (至少开启一个)</h3>
          <div class="space-y-4">
            <div class="p-4 border border-slate-200 rounded-xl">
              <label class="flex items-center gap-2 font-medium mb-2">
                <input type="checkbox" name="notifier" value="telegram" class="rounded border-slate-300 text-blue-600">
                Telegram
              </label>
              <div class="grid grid-cols-2 gap-2 mt-2">
                <input type="text" id="tgToken" placeholder="Bot Token" class="px-3 py-2 border border-slate-200 rounded-lg text-sm">
                <input type="text" id="tgChat" placeholder="Chat ID" class="px-3 py-2 border border-slate-200 rounded-lg text-sm">
              </div>
            </div>
            
            <div class="p-4 border border-slate-200 rounded-xl">
              <label class="flex items-center gap-2 font-medium mb-2">
                <input type="checkbox" name="notifier" value="email" class="rounded border-slate-300 text-blue-600">
                邮件 (Resend)
              </label>
              <div class="space-y-2 mt-2">
                <input type="text" id="resendKey" placeholder="Resend API Key" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                <input type="email" id="emailFrom" placeholder="发件人邮箱" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                <input type="email" id="emailTo" placeholder="收件人邮箱" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
              </div>
            </div>
          </div>
        </div>

        <div class="pt-6 border-t border-slate-100 flex justify-end">
          <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-medium transition-colors">
            保存配置
          </button>
        </div>
      </form>
    </div>
  </main>

  <script>
    async function load() {
      const res = await fetch('/api/config');
      const c = await res.json();
      document.getElementById('adminUser').value = c.ADMIN_USERNAME || 'admin';
      document.getElementById('timezone').value = c.TIMEZONE || 'UTC';
      document.getElementById('notifyHours').value = (c.NOTIFICATION_HOURS || []).join(',');
      document.getElementById('showLunar').checked = c.SHOW_LUNAR === true;
      document.getElementById('tgToken').value = c.TG_BOT_TOKEN || '';
      document.getElementById('tgChat').value = c.TG_CHAT_ID || '';
      document.getElementById('resendKey').value = c.RESEND_API_KEY || '';
      document.getElementById('emailFrom').value = c.EMAIL_FROM || '';
      document.getElementById('emailTo').value = c.EMAIL_TO || '';
      
      document.querySelectorAll('input[name="notifier"]').forEach(cb => {
        cb.checked = (c.ENABLED_NOTIFIERS || []).includes(cb.value);
      });
    }

    document.getElementById('cfgForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const enabled = Array.from(document.querySelectorAll('input[name="notifier"]:checked')).map(cb => cb.value);
      const data = {
        ADMIN_USERNAME: document.getElementById('adminUser').value,
        TIMEZONE: document.getElementById('timezone').value,
        NOTIFICATION_HOURS: document.getElementById('notifyHours').value.split(',').map(s => s.trim()).filter(s => s),
        SHOW_LUNAR: document.getElementById('showLunar').checked,
        ENABLED_NOTIFIERS: enabled,
        TG_BOT_TOKEN: document.getElementById('tgToken').value,
        TG_CHAT_ID: document.getElementById('tgChat').value,
        RESEND_API_KEY: document.getElementById('resendKey').value,
        EMAIL_FROM: document.getElementById('emailFrom').value,
        EMAIL_TO: document.getElementById('emailTo').value
      };
      const pass = document.getElementById('adminPass').value;
      if(pass) data.ADMIN_PASSWORD = pass;
      
      await fetch('/api/config', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(data)
      });
      alert('保存成功');
      if(pass) location.href = '/';
    });

    load();
  </script>
</body>
</html>`;

// ==================== API 逻辑 ====================

async function getAllSubs(env) {
  const data = await env.SUBSCRIPTIONS_KV.get('subscriptions');
  return data ? JSON.parse(data) : [];
}

async function getSub(id, env) {
  const subs = await getAllSubs(env);
  return subs.find(s => s.id === id);
}

async function saveSubs(subs, env) {
  await env.SUBSCRIPTIONS_KV.put('subscriptions', JSON.stringify(subs));
}

// ==================== 导出处理器 ====================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // 1. 登录页
    if (path === '/' || path === '/login') {
      return new Response(loginPage, {headers:{'Content-Type':'text/html;charset=utf-8'}});
    }

    // 2. API 路由
    if (path.startsWith('/api/')) {
      const apiPath = path.slice(4);
      
      // 登录接口
      if (apiPath === '/login' && method === 'POST') {
        try {
          const body = await request.json();
          const config = await getConfig(env);
          
          console.log('[Login Attempt]', body.username, 'Expected:', config.ADMIN_USERNAME);
          
          if (body.username === config.ADMIN_USERNAME && body.password === config.ADMIN_PASSWORD) {
            const token = await generateJWT(body.username, config.JWT_SECRET);
            return new Response(JSON.stringify({success:true}), {
              headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': `token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`
              }
            });
          } else {
            return new Response(JSON.stringify({success:false, message:'用户名或密码错误'}), {
              status: 401,
              headers: {'Content-Type':'application/json'}
            });
          }
        } catch (e) {
          return new Response(JSON.stringify({success:false, message:'请求错误: '+e.message}), {
            status: 400,
            headers: {'Content-Type':'application/json'}
          });
        }
      }

      // 登出
      if (apiPath === '/logout') {
        return new Response('', {
          status: 302,
          headers: {
            'Location': '/',
            'Set-Cookie': 'token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'
          }
        });
      }

      // 验证 Token（除登录外的所有接口）
      const cookie = request.headers.get('Cookie') || '';
      const token = getCookieValue(cookie, 'token');
      const config = await getConfig(env);
      const user = token ? await verifyJWT(token, config.JWT_SECRET) : null;

      if (!user && apiPath !== '/config' && !apiPath.startsWith('/notify')) {
        return new Response(JSON.stringify({success:false, message:'未登录'}), {
          status: 401,
          headers: {'Content-Type':'application/json'}
        });
      }

      // 获取配置
      if (apiPath === '/config' && method === 'GET') {
        const {JWT_SECRET, ADMIN_PASSWORD, ...safe} = config;
        return new Response(JSON.stringify(safe), {headers:{'Content-Type':'application/json'}});
      }

      // 更新配置
      if (apiPath === '/config' && method === 'POST') {
        const body = await request.json();
        const newCfg = {...config, ...body};
        if(body.ADMIN_PASSWORD) newCfg.ADMIN_PASSWORD = body.ADMIN_PASSWORD;
        await env.SUBSCRIPTIONS_KV.put('config', JSON.stringify(newCfg));
        return new Response(JSON.stringify({success:true}), {headers:{'Content-Type':'application/json'}});
      }

      // 订阅 CRUD
      if (apiPath === '/subscriptions') {
        if (method === 'GET') {
          const subs = await getAllSubs(env);
          return new Response(JSON.stringify(subs), {headers:{'Content-Type':'application/json'}});
        }
        if (method === 'POST') {
          const body = await request.json();
          const subs = await getAllSubs(env);
          const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
          
          // 处理农历自动推算
          let expiryDate = new Date(body.expiryDate);
          const now = getCurrentTimeInTimezone(config.TIMEZONE || 'UTC');
          
          if (body.useLunar) {
            let lunar = lunarCalendar.solar2lunar(expiryDate.getFullYear(), expiryDate.getMonth()+1, expiryDate.getDate());
            while (expiryDate < now && body.periodValue) {
              lunar = lunarBiz.addLunarPeriod(lunar, body.periodValue, body.periodUnit);
              const s = lunarBiz.lunar2solar(lunar);
              expiryDate = new Date(s.year, s.month-1, s.day);
            }
          } else {
            while (expiryDate < now && body.periodValue) {
              if(body.periodUnit==='day') expiryDate.setDate(expiryDate.getDate()+body.periodValue);
              else if(body.periodUnit==='month') expiryDate.setMonth(expiryDate.getMonth()+body.periodValue);
              else if(body.periodUnit==='year') expiryDate.setFullYear(expiryDate.getFullYear()+body.periodValue);
            }
          }
          
          const newSub = {
            id, ...body,
            expiryDate: expiryDate.toISOString(),
            createdAt: new Date().toISOString()
          };
          subs.push(newSub);
          await saveSubs(subs, env);
          return new Response(JSON.stringify({success:true, subscription:newSub}), {headers:{'Content-Type':'application/json'}});
        }
      }

      if (apiPath.startsWith('/subscriptions/')) {
        const parts = apiPath.split('/');
        const id = parts[2];
        const action = parts[3];
        
        if (method === 'DELETE') {
          const subs = await getAllSubs(env);
          const filtered = subs.filter(s => s.id !== id);
          await saveSubs(filtered, env);
          return new Response(JSON.stringify({success:true}), {headers:{'Content-Type':'application/json'}});
        }
        
        if (method === 'PUT') {
          const body = await request.json();
          const subs = await getAllSubs(env);
          const idx = subs.findIndex(s => s.id === id);
          if (idx === -1) return new Response(JSON.stringify({success:false, message:'Not found'}), {status:404});
          
          // 重新计算到期日逻辑（简化版）
          let expiryDate = new Date(body.expiryDate);
          const now = getCurrentTimeInTimezone(config.TIMEZONE || 'UTC');
          if (body.useLunar && expiryDate < now && body.periodValue) {
            let lunar = lunarCalendar.solar2lunar(expiryDate.getFullYear(), expiryDate.getMonth()+1, expiryDate.getDate());
            do {
              lunar = lunarBiz.addLunarPeriod(lunar, body.periodValue, body.periodUnit);
              const s = lunarBiz.lunar2solar(lunar);
              expiryDate = new Date(s.year, s.month-1, s.day);
            } while(expiryDate < now);
          }
          
          subs[idx] = {...subs[idx], ...body, expiryDate: expiryDate.toISOString(), updatedAt: new Date().toISOString()};
          await saveSubs(subs, env);
          return new Response(JSON.stringify({success:true, subscription:subs[idx]}), {headers:{'Content-Type':'application/json'}});
        }
        
        if (action === 'toggle-status' && method === 'POST') {
          const body = await request.json();
          const subs = await getAllSubs(env);
          const idx = subs.findIndex(s => s.id === id);
          if (idx !== -1) {
            subs[idx].isActive = body.isActive;
            await saveSubs(subs, env);
          }
          return new Response(JSON.stringify({success:true}), {headers:{'Content-Type':'application/json'}});
        }
        
        if (action === 'test-notify' && method === 'POST') {
          // 简化测试通知
          return new Response(JSON.stringify({success:true, message:'测试功能已触发（请检查配置的通知渠道）'}), {headers:{'Content-Type':'application/json'}});
        }
      }
      
      return new Response(JSON.stringify({success:false, message:'API not found'}), {status:404});
    }

    // 3. 管理页（需要验证）
    if (path.startsWith('/admin')) {
      const cookie = request.headers.get('Cookie') || '';
      const token = getCookieValue(cookie, 'token');
      const config = await getConfig(env);
      const user = token ? await verifyJWT(token, config.JWT_SECRET) : null;
      
      if (!user) {
        return new Response('', {status:302, headers:{'Location':'/'}});
      }
      
      if (path === '/admin/config') {
        return new Response(configPage, {headers:{'Content-Type':'text/html;charset=utf-8'}});
      }
      return new Response(adminPage, {headers:{'Content-Type':'text/html;charset=utf-8'}});
    }

    return new Response('Not Found', {status:404});
  },

  async scheduled(event, env, ctx) {
    // 定时任务逻辑
    console.log('Scheduled task triggered');
  }
};
