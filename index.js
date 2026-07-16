// ============================================================
//  PREMIUM BOT - COMPLETE FINAL VERSION (100%)
// ============================================================

try { process.loadEnvFile?.('.env.development.local'); } catch (error) { /* Environment variables may already be injected by the host. */ }

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const express = require('express');
const https = require('https');
const crypto = require('crypto');
const premiumStore = require('./lib/premium-store');

const token = '8289204973:AAHFeXFMIihfZ3nrZgaxYulUEGAmLZAjaGY';

// ─── AI CONFIG ───
const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';

if (!token || token.includes('xxxxxxx')) {
    console.error('✘ FATAL: Bot token is missing or still the placeholder value.');
    console.error('Edit bot.js and set your real token from @BotFather before starting.');
    process.exit(1);
}

// ─── SINGLE-INSTANCE LOCK ───
// Telegram only allows ONE active getUpdates poller per bot token. If two
// processes are polling at once (e.g. a stale process left over from a bad
// stop/crash, plus a freshly started one), updates get split between them
// unpredictably — which looks like "I have to tap a button several times
// before anything happens."
//
// Rather than refusing to start, a second process WAITS (does not poll,
// does not exit) until the live one actually stops, then takes the lock
// and starts polling itself automatically. On a clean stop/restart the
// lock is released immediately, so the waiting instance picks up right
// away with no manual steps.
const LOCK_FILE = path.join(__dirname, 'bot.lock');
const LOCK_RETRY_MS = 5000;
const LOCK_MAX_WAIT_MS = 30000;

function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return false;
    }
}

function acquireSingleInstanceLock() {
    return new Promise((resolve) => {
        let waitingLogged = false;
        let lastLogAt = 0;
        let startWaitTime = Date.now();
        
        const tryAcquire = () => {
            if (fs.existsSync(LOCK_FILE)) {
                const existingPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
                const lockAge = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
                
                // If the lock is stale (old PID not alive, or lock file older than 30s),
                // take it over immediately. This prevents hanging on fresh container
                // deploys where old lock files might linger.
                if (existingPid && existingPid !== process.pid && isPidAlive(existingPid) && lockAge < LOCK_MAX_WAIT_MS) {
                    const now = Date.now();
                    if (!waitingLogged || now - lastLogAt > 30000) {
                        console.log(`⏳ Another instance is already running (PID ${existingPid}). Waiting for it to stop before starting polling...`);
                        waitingLogged = true;
                        lastLogAt = now;
                    }
                    setTimeout(tryAcquire, LOCK_RETRY_MS);
                    return;
                }
                // stale lock (old PID no longer running, or lock is old) — safe to take over
                if (lockAge > LOCK_MAX_WAIT_MS) {
                    console.log(`🧹 Stale lock detected (age: ${(lockAge/1000).toFixed(1)}s), taking over.`);
                }
            }
            fs.writeFileSync(LOCK_FILE, String(process.pid));
            console.log(`${E.sparkle} Lock acquired (PID ${process.pid}). Starting webhook server.`);
            resolve();
        };
        tryAcquire();
    });
}

function releaseSingleInstanceLock() {
    try {
        if (fs.existsSync(LOCK_FILE) && fs.readFileSync(LOCK_FILE, 'utf8').trim() === String(process.pid)) {
            fs.unlinkSync(LOCK_FILE);
        }
    } catch (e) {}
}
process.on('exit', releaseSingleInstanceLock);

const bot = new TelegramBot(token, { polling: false });

// ─── STOP COMMAND COOLDOWN ───
const stopCooldown = new Map();

const MENU_VIDEO = 'https://cdn.crysnovax.link/files/1782817835719-2fed0565-2268-4e23-8f18-373869332734.mp4';
const MENU_IMAGE = 'https://cdn.crysnovax.link/files/1781301435194-4ccb6d3d-5142-4753-a170-bfada6df12b9.jpeg';
const DB_FILE = path.join(__dirname, 'groupdata.json');

// ─── EMOJIS ───
const E = {
    sparkle: '✆',
    star: '★',
    crown: '👑',
    gem: '💎',
    rocket: '🚀',
    fire: '🔥',
    lightning: '⚡',
    shield: '🛡',
    trophy: '🏆',
    medal: '🎖',
    comet: '☄',
    vortex: '🌀',
    crystal: '🔮',
    atom: '⚛',
    galaxy: '🌌',
    rainbow: '🌈',
    phoenix: '🐦‍🔥',
    dragon: '🐉',
    unicorn: '🦄',
    nebula: '🌠',
    yes: '✅',
    no: '❌',
    warn: '⚠️',
    info: 'ℹ️',
    question: '❓',
    plus: '➕',
    minus: '➖',
    check: '✔️',
    cross: '✖️',
    smile: '😊',
    laugh: '😂',
    think: '🤔',
    wow: '😮',
    cry: '😢',
    angry: '😡',
    love: '🥰',
    cool: '😎',
    party: '🎉',
    gift: '🎁',
    confetti: '🎊',
    balloon: '🎈',
    cake: '🎂',
    champagne: '🍾',
    clap: '👏',
    wave: '👋',
    sun: '☀️',
    moon: '🌙',
    star2: '⭐',
    rainbow2: '🌈',
    rose: '🌹',
    lotus: '🪷',
    butterfly: '🦋',
    ai: '🤖',
    code: '💻',
    database: '🗄',
    cloud: '☁️',
    wifi: '📶',
    link: '🔗',
    lock: '🔒',
    unlock: '🔓',
    key: '🔑',
    clock: '🕐',
    calendar: '📅',
    hourglass: '⏳',
    premium: '💠',
    vip: '⭐',
    ultimate: '🔥',
    pro: '🚀',
    elite: '👑',
    master: '🏆',
    legend: '🌟',
    mythic: '✨',
    divine: '💫',
    cosmic: '🌌',
    stellar: '⭐',
    lunar: '🌙',
    solar: '☀️',
    nova: '💥',
    puzzle: '🧩',
    note: '📝',
    gear: '⚙️',
    game: '🎮',
    music: '🎵',
    brush: '🎨',
    download: '📥',
    upload: '📤',
    tiktok: '📱',
    wallpaper: '🖼️',
    movie: '🎬',
    football: '⚽',
    voice: '🎙️',
    tempemail: '📧',
    ocr: '📄',
    search: '🔍'
};

// ─── TELEGRAM PREMIUM EMOJI SYSTEM ───
// Public custom-emoji IDs are used only after Telegram validates them at startup.
// Persisted/owner-learned IDs override these seeds.
const PUBLIC_PREMIUM_EMOJIS = {
    '👍': '5469770542288478598',
    '❤️': '5449505950283078474',
    '🔥': '5420315771991497307',
    '🎉': '5436040291507247633',
    '✨': '5472164874886846699'
};
const PREMIUM_EMOJIS = { ...PUBLIC_PREMIUM_EMOJIS };
const PREMIUM_FILE = path.join(__dirname, 'premium_emojis.json');

function loadPremiumEmojis() {
    try {
        if (fs.existsSync(PREMIUM_FILE)) {
            const data = JSON.parse(fs.readFileSync(PREMIUM_FILE, 'utf8'));
            Object.assign(PREMIUM_EMOJIS, data);
            console.log(`${E.sparkle} Loaded ${Object.keys(PREMIUM_EMOJIS).length} premium emojis`);
        }
    } catch (e) {
        console.error('Failed to load premium emojis:', e.message);
    }
}

function savePremiumEmojis() {
    try {
        fs.writeFileSync(PREMIUM_FILE, JSON.stringify(PREMIUM_EMOJIS, null, 2));
    } catch (e) {
        console.error('Failed to save premium emojis:', e.message);
    }
}

function collectPremiumEmoji(msg) {
    // Collect from BOTH message text and media captions, so any custom
    // (animated) emoji an admin sends the bot is learned and reusable.
    const sources = [
        { text: msg.text, entities: msg.entities },
        { text: msg.caption, entities: msg.caption_entities }
    ];
    for (const src of sources) {
        if (!src.text || !Array.isArray(src.entities)) continue;
        for (const ent of src.entities) {
            if (ent.type !== 'custom_emoji' || !ent.custom_emoji_id) continue;
            const emojiChar = src.text.substr(ent.offset, ent.length);
            if (!emojiChar) continue;
            if (PREMIUM_EMOJIS[emojiChar] !== ent.custom_emoji_id) {
                PREMIUM_EMOJIS[emojiChar] = ent.custom_emoji_id;
                savePremiumEmojis();
                console.log(`✨ Collected premium emoji: ${emojiChar} → ${ent.custom_emoji_id}`);
            }
        }
    }
}

// Build custom_emoji entities for every collected premium emoji found in the
// text, so static emojis in the bot's messages render as animated premium
// versions. Telegram entity offsets are UTF-16 code units = JS string indices.
// Longer glyphs (ZWJ sequences) match first so they aren't partially consumed.
function buildPremiumEntities(text) {
    if (!text || typeof text !== 'string') return [];
    const chars = Object.keys(PREMIUM_EMOJIS).filter(Boolean).sort((a, b) => b.length - a.length);
    if (!chars.length) return [];
    const entities = [];
    const taken = new Array(text.length).fill(false);
    for (const ch of chars) {
        const id = PREMIUM_EMOJIS[ch];
        let from = 0;
        let idx;
        while ((idx = text.indexOf(ch, from)) !== -1) {
            let free = true;
            for (let i = idx; i < idx + ch.length; i++) { if (taken[i]) { free = false; break; } }
            if (free) {
                for (let i = idx; i < idx + ch.length; i++) taken[i] = true;
                entities.push({ type: 'custom_emoji', offset: idx, length: ch.length, custom_emoji_id: id });
            }
            from = idx + ch.length;
        }
    }
    entities.sort((a, b) => a.offset - b.offset);
    return entities;
}

function mergePremiumEntities(text, existing = []) {
    const base = Array.isArray(existing) ? existing.filter(Boolean) : [];
    const premium = buildPremiumEntities(text).filter(candidate => !base.some(entity => {
        if (entity.type !== 'custom_emoji') return false;
        const entityEnd = entity.offset + entity.length;
        const candidateEnd = candidate.offset + candidate.length;
        return candidate.offset < entityEnd && entity.offset < candidateEnd;
    }));
    return [...base, ...premium].sort((a, b) => a.offset - b.offset || b.length - a.length);
}

// Telegram accepts formatting and custom_emoji entities together. Keep the
// sender's entities and add animated emoji only where ranges do not overlap.
function withPremiumText(text, options) {
    if (!text || typeof text !== 'string' || (options && options.parse_mode)) return options;
    const entities = mergePremiumEntities(text, options && options.entities);
    if (!entities.length) return options;
    return { ...(options || {}), entities };
}

function withPremiumCaption(caption, options) {
    if (!caption || typeof caption !== 'string' || (options && options.parse_mode)) return options;
    const captionEntities = mergePremiumEntities(caption, options && options.caption_entities);
    if (!captionEntities.length) return options;
    return { ...(options || {}), caption_entities: captionEntities };
}

async function validatePublicPremiumEmojis() {
    const seededIds = [...new Set(Object.values(PUBLIC_PREMIUM_EMOJIS))];
    if (!seededIds.length) return;
    try {
        const stickers = await bot.getCustomEmojiStickers(seededIds);
        const validIds = new Set((stickers || []).map(sticker => sticker.custom_emoji_id));
        for (const [emoji, id] of Object.entries(PUBLIC_PREMIUM_EMOJIS)) {
            if (!validIds.has(id) && PREMIUM_EMOJIS[emoji] === id) delete PREMIUM_EMOJIS[emoji];
        }
    } catch (error) {
        // Fail closed for unverified public IDs; learned persisted IDs remain.
        for (const [emoji, id] of Object.entries(PUBLIC_PREMIUM_EMOJIS)) {
            if (PREMIUM_EMOJIS[emoji] === id) delete PREMIUM_EMOJIS[emoji];
        }
    }
}

loadPremiumEmojis();

// ─── SMART RESPONSES ───
const smartResponses = [
    { pattern: /^(hi|hello|hey|howdy|greetings|sup|yo|hai|hii|hiii)/i, 
      response: `Hey there! Ready to explore? Send /menu to get started.` },
    { pattern: /^(good morning|gm|morning)/i,
      response: `Rise and shine! A beautiful day awaits you.` },
    { pattern: /^(good evening|ge|evening)/i,
      response: `Good evening! The night is full of possibilities.` },
    { pattern: /^(good night|gn|night)/i,
      response: `Sweet dreams! May the stars guide your dreams.` },
    { pattern: /^(what's up|wassup|sup|wyd|how are you|how are you doing)/i,
      response: `Chilling! Ready to make your day amazing.` },
    { pattern: /^(thank|thanks|ty|thx|thank you)/i,
      response: `You're welcome! Always happy to help.` },
    { pattern: /(weather|rain|sun|hot|cold|temperature)/i,
      response: `Check weather with /weather <city> Stay informed!` },
    { pattern: /(game|play|fun|entertain)/i,
      response: `Game time! Tap /menu and go to GAMES.` },
    { pattern: /(lol|lmao|rofl|haha|hehe|funny|hilarious)/i,
      response: `Glad you enjoyed that! Laughter is the best medicine.` },
    { pattern: /(omg|wow|amazing|awesome|great|nice|cool)/i,
      response: `I know right! This is just the beginning.` },
    { pattern: /(sad|depressed|unhappy|down|feeling bad)/i,
      response: `I'm sorry you're feeling down. Remember: tough times don't last, but tough people do.` }
];

function getSmartResponse(text) {
    const lower = text.toLowerCase();
    for (const item of smartResponses) {
        if (item.pattern.test(lower)) {
            return item.response;
        }
    }
    return null;
}

// ─── BOT CONFIG ───
const BOT_OWNER_IDS = [7770578824]; 
const DEV_CONTACT = 't.me/crysnovax';
const EBOT_USERNAME = '@CODYEBOT';

// ─── CREATOR IMMUNITY ───
// True if userId belongs to the bot's hardcoded owner/creator. Used to
// exempt the creator from the bot's own kick/ban/mute/warn actions so an
// admin can never remove them from a group using the bot's own commands.
function isProtectedOwner(userId) {
    return BOT_OWNER_IDS.includes(Number(userId));
}
const OWNER_IMMUNE_MSG = `ⓘ Can't do that — this user is my creator.`;

// ─── FORCE JOIN CHANNELS ───
const FORCE_JOIN_CHANNELS = [
    { name: 'CODY Updates', username: '@CODY_CH', link: 'https://t.me/CODY_CH' },
    { name: 'CRYSNOVA AI', username: '@CRYSNOVA_AI', link: 'https://t.me/CRYSNOVA_AI' }
];

console.log(`${E.sparkle} Bot starting...`);

let BOT_ID = null;
let BOT_USERNAME = null;

// ─── DATABASE ───
let db = {};
const dmUsers = new Set();
const tempEmails = {};
const pendingCaptchaSetup = {};
const pendingWelcomeSetup = {};
const pendingGoodbyeSetup = {};
const pendingSetWelcomeSetup = {};
const pendingSetGoodbyeSetup = {};
const pendingBroadcastSetup = {};
const verifiedUsers = new Set();
const recentJoins = {};
const lockTimers = {};
const wordChainTimers = {};
const triviaTimers = {};
const emojiTimers = {};
const mathTimers = {};
const todGames = {};
let jobWorkerTimer = null;

function loadDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            if (Array.isArray(db.__dmUsers)) {
                db.__dmUsers.forEach(id => dmUsers.add(id));
            }
        }
    } catch (e) {
        console.error('Failed to load DB, starting fresh:', e.message);
        db = {};
    }
}

let saveTimeout = null;
function saveDB() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        db.__dmUsers = Array.from(dmUsers);
        fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), (err) => {
            if (err) console.error('Failed to save DB:', err.message);
        });
    }, 500);
}

const DEFAULT_WELCOME_CONFIG = {
    message: 'Welcome {name} to {group}! 🎉\nPlease read the rules and enjoy your stay.',
    ppEnabled: true,
    button: { text: '˗ˏˋ☏ˎˊ˗ Hit me up!', url: 'https://t.me/CODYEBOT' }
};

function applyDefaultWelcome(chatId) {
    const group = getGroup(chatId);
    group.welcomeEnabled = true;
    group.welcomeMsg = DEFAULT_WELCOME_CONFIG.message;
    group.welcomePPEnabled = DEFAULT_WELCOME_CONFIG.ppEnabled;
    group.welcomeUrl = { ...DEFAULT_WELCOME_CONFIG.button };
    saveDB();
    return group;
}

async function confirmDefaultWelcome(msg, pendingStore) {
    applyDefaultWelcome(msg.chat.id);
    delete pendingStore[msg.chat.id];
    await bot.sendMessage(msg.chat.id, '▫️', { reply_markup: { remove_keyboard: true } });
    const preview = DEFAULT_WELCOME_CONFIG.message
        .replace('{name}', msg.from.first_name || 'User')
        .replace('{group}', msg.chat.title || 'this group');
    await bot.sendMessage(msg.chat.id, `Default welcome enabled.\n\nPreview:\n${preview}`, {
        reply_markup: { inline_keyboard: [[{ ...DEFAULT_WELCOME_CONFIG.button }]] }
    });
}

function getGroup(chatId) {
    const key = String(chatId);
    if (!db[key]) {
        db[key] = {
            welcomeEnabled: true,
            welcomeMsg: 'Welcome {name} to {group}! 🎉\nPlease read the rules and enjoy your stay.',
            welcomePPEnabled: true,
            welcomeUrl: null,
            goodbyeMsg: '{name} has left {group}. 👋',
            antilinkEnabled: false,
            antilinkMode: 'warn',
            antilinkWhitelist: ['crysnovax.link'],
            nostickerEnabled: false,
            antitagEnabled: false,
            captchaEnabled: false,
            captchaType: 'default',
            captchaQuestion: null,
            captchaAnswer: null,
            captchaWrongAnswer: null,
            captchaAttempts: {},
            logChatId: null,
            filters: {},
            warns: {},
            pendingCaptcha: {},
            knownMembers: {},
            lock: { active: false, until: null },
            notes: {},
            rules: null,
            stats: { messages: 0, joins: 0, leaves: 0, members: {} },
            antiraidEnabled: false,
            antiraidJoinCount: 5,
            antiraidWindowSec: 10,
            sleeping: false,
            gameScores: {},
            gameState: null,
            translateTo: null,
            uiLang: null,
            botName: null,
            prefix: '/',
            aiMemory: []
        };
    }
    const g = db[key];
    const defaults = {
        goodbyeMsg: '{name} has left {group}. 👋',
        welcomePPEnabled: true,
        welcomeUrl: null,
        antilinkEnabled: false,
        antilinkMode: 'warn',
        antilinkWhitelist: ['crysnovax.link'],
        nostickerEnabled: false,
        antitagEnabled: false,
        captchaEnabled: false,
        captchaType: 'default',
        captchaQuestion: null,
        captchaAnswer: null,
        captchaWrongAnswer: null,
        captchaAttempts: {},
        logChatId: null,
        filters: {},
        warns: {},
        pendingCaptcha: {},
        knownMembers: {},
        lock: { active: false, until: null },
        translateTo: null,
        uiLang: null,
        notes: {},
        rules: null,
        stats: { messages: 0, joins: 0, leaves: 0, members: {} },
        antiraidEnabled: false,
        antiraidJoinCount: 5,
        antiraidWindowSec: 10,
        botName: null,
        sleeping: false,
        gameScores: {},
        gameState: null,
        prefix: '/',
        aiMemory: []
    };
    for (const [key, val] of Object.entries(defaults)) {
        if (g[key] === undefined) g[key] = val;
    }
    return g;
}

loadDB();

// ─── HELPERS ───
// isAdmin() is called from 60+ command handlers. Without caching, every
// single admin-gated command (kick/ban/mute/warn/pin/etc.) fires a fresh
// getChatMember network call to Telegram — under concurrent use across
// many groups this adds real, compounding latency. Cached for 60s per
// chat+user, with a periodic sweep so the cache doesn't grow unbounded
// over long uptimes.
const _adminStatusCache = new Map(); // `${chatId}:${userId}` -> { isAdmin, expires }
const ADMIN_CACHE_TTL_MS = 60000;

async function isAdmin(chatId, userId) {
    const cacheKey = `${chatId}:${userId}`;
    const cached = _adminStatusCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.isAdmin;
    try {
        const member = await bot.getChatMember(chatId, userId);
        const result = ['administrator', 'creator'].includes(member.status);
        _adminStatusCache.set(cacheKey, { isAdmin: result, expires: Date.now() + ADMIN_CACHE_TTL_MS });
        return result;
    } catch (e) {
        return false;
    }
}

setInterval(() => {
    const now = Date.now();
    for (const [key, val] of _adminStatusCache) {
        if (val.expires <= now) _adminStatusCache.delete(key);
    }
}, 10 * 60 * 1000);

function getUptime() {
    const totalSeconds = Math.floor(process.uptime());
    const m = Math.floor(totalSeconds / 60);
    return `${m}m`;
}

function getRAM() {
    const used = (process.memoryUsage().rss / 1024 / 1024 / 1024).toFixed(1);
    const total = (require('os').totalmem() / 1024 / 1024 / 1024).toFixed(1);
    const percent = ((used / total) * 100).toFixed(0);
    return `${used}/${total}GB (${percent}%)`;
}

// Escapes the 3 characters HTML parse_mode treats as significant. Needed
// anywhere dynamic/user-influenced text (e.g. a group's chat.title) is
// interpolated into a parse_mode: 'HTML' message — otherwise a title
// containing '<', '>', or '&' can break entity parsing or, worse, be
// misread as a real (if invalid) tag and reject the whole send.
function escapeHTML(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function sendLog(chatId, text) {
    const group = getGroup(chatId);
    if (!group.logChatId) return;
    bot.sendMessage(group.logChatId, text, { parse_mode: 'Markdown' }).catch(() => {});
}

function trackMember(chatId, user) {
    if (!user || user.is_bot) return;
    const group = getGroup(chatId);
    group.knownMembers[String(user.id)] = {
        name: user.first_name || 'Unknown',
        username: user.username || null
    };
    saveDB();
}

function trackDMUser(userId) {
    if (!userId || dmUsers.has(userId)) return;
    dmUsers.add(userId);
    saveDB();
}

function getUserDisplay(user) {
    if (!user) return 'Unknown';
    if (user.username) return `@${user.username}`;
    return user.first_name || user.last_name || 'Unknown';
}

function getUserLink(user) {
    const name = getUserDisplay(user);
    return `[${name}](tg://user?id=${user.id})`;
}

function getUserMention(user) {
    if (!user) return 'Unknown';
    if (user.username) return `@${user.username}`;
    return `<a href="tg://user?id=${user.id}">${user.first_name || 'User'}</a>`;
}

// ─── CAPTCHA CONTENT HELPERS ───
// Builds { questionText, correctAnswer, options } for either captcha type.
// Default: arithmetic question with 3 numeric options.
// Custom: admin-set question with exactly 2 options — the correct answer and
// the admin-set wrong answer — since a text answer can't have arithmetic
// distractors generated for it.
function generateCaptchaContent(group) {
    let questionText, correctAnswer, options;
    if (group.captchaType === 'custom' && group.captchaQuestion && group.captchaAnswer && group.captchaWrongAnswer) {
        questionText = group.captchaQuestion;
        correctAnswer = group.captchaAnswer;
        options = [group.captchaAnswer, group.captchaWrongAnswer].sort(() => Math.random() - 0.5);
    } else {
        const a = Math.floor(Math.random() * 8) + 1;
        const b = Math.floor(Math.random() * 8) + 1;
        questionText = `What is ${a} + ${b}?`;
        correctAnswer = String(a + b);
        const answerNum = a + b;
        let nums = [answerNum];
        for (let i = 0; i < 2; i++) {
            let randomOption;
            let attemptsLoop = 0;
            do {
                randomOption = answerNum + Math.floor(Math.random() * 5) - 2;
                attemptsLoop++;
            } while ((randomOption === answerNum || nums.includes(randomOption) || randomOption < 0) && attemptsLoop < 10);
            if (randomOption !== answerNum && !nums.includes(randomOption) && randomOption >= 0) {
                nums.push(randomOption);
            }
        }
        while (nums.length < 3) {
            let newOption = answerNum + nums.length;
            if (!nums.includes(newOption) && newOption >= 0) {
                nums.push(newOption);
            } else {
                newOption = answerNum - nums.length;
                if (!nums.includes(newOption) && newOption >= 0) {
                    nums.push(newOption);
                }
            }
        }
        options = nums.sort(() => Math.random() - 0.5).map(String);
    }
    return { questionText, correctAnswer, options };
}

// Buttons carry the option's index (not the raw text) in callback_data —
// keeps callback_data short/safe and works whether options are numbers or
// arbitrary custom-captcha text.
function buildCaptchaKeyboard(attemptId, options) {
    return {
        inline_keyboard: [
            options.map((opt, idx) => ({
                text: `${opt}`,
                callback_data: `captcha_${attemptId}_${idx}`
            }))
        ]
    };
}

function captchaAnswersMatch(a, b) {
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

// Sends the group's welcome message with the joining member's profile photo
// when Welcome-with-PP is enabled, falling back to plain text. Shared by the
// normal join flow and the post-captcha-verification flow so both behave
// identically.
async function sendGroupWelcome(chatId, group, member, welcomeText) {
    const opts = { caption: welcomeText, parse_mode: 'Markdown' };
    if (group.welcomeUrl && group.welcomeUrl.url) {
        opts.reply_markup = {
            inline_keyboard: [[
                { text: group.welcomeUrl.text || 'Click Here', url: group.welcomeUrl.url }
            ]]
        };
    }
    if (group.welcomePPEnabled && member) {
        try {
            const photos = await bot.getUserProfilePhotos(member.id, { limit: 1 });
            if (photos && photos.total_count > 0) {
                const fileId = photos.photos[0][photos.photos[0].length - 1].file_id;
                const sent = await bot.sendPhoto(chatId, fileId, opts);
                setTimeout(() => {
                    bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                }, 30000);
                return;
            }
        } catch (photoErr) {
            console.warn(`Could not get profile photo for ${member.id}:`, photoErr.message);
        }
    }
    const textOpts = { parse_mode: 'Markdown' };
    if (group.welcomeUrl && group.welcomeUrl.url) {
        textOpts.reply_markup = opts.reply_markup;
    }
    const sent = await bot.sendMessage(chatId, welcomeText, textOpts).catch(() => {});
    if (sent) {
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        }, 30000);
    }
}

// ─── TRUTH OR DARE ENGINE ───
// One session per group, held in memory (todGames), not persisted to disk —
// it's a live party-game session, not durable config.
function todMention(player) {
    return `[${player.name}](tg://user?id=${player.id})`;
}

function fillTODPrompt(template, game) {
    const partner = game.players[game.partnerUserId];
    return template.replace(/\{partner\}/g, partner ? todMention(partner) : 'someone');
}

// Rotates to the next player's turn and picks a random partner from the
// remaining players. Returns false if there aren't enough players left.
function advanceTODTurn(game) {
    if (game.playerOrder.length < 2) return false;
    game.turnIndex = (game.turnIndex + 1) % game.playerOrder.length;
    const turnUserId = game.playerOrder[game.turnIndex];
    const others = game.playerOrder.filter(id => id !== turnUserId);
    if (others.length === 0) return false;
    game.turnUserId = turnUserId;
    game.partnerUserId = others[Math.floor(Math.random() * others.length)];
    game.type = null;
    game.prompt = null;
    game.phase = 'choosing';
    return true;
}

// Picks a fresh random partner for the current turn player (used when the
// partner leaves mid-round, or when the "Next" button rerolls the prompt).
function reselectTODPartner(game) {
    const others = game.playerOrder.filter(id => id !== game.turnUserId);
    if (others.length === 0) return false;
    game.partnerUserId = others[Math.floor(Math.random() * others.length)];
    return true;
}

function buildTODKeyboard(game) {
    if (game.phase === 'lobby') {
        return {
            inline_keyboard: [
                [{ text: '🟢 Join', callback_data: 'tod_join' }, { text: '🚪 Leave', callback_data: 'tod_leave' }],
                [{ text: '🔴 Cancel', callback_data: 'tod_cancel' }]
            ]
        };
    }
    if (game.phase === 'choosing') {
        return {
            inline_keyboard: [
                [{ text: '❓ Truth', callback_data: 'tod_truth' }, { text: '🔥 Dare', callback_data: 'tod_dare' }],
                [{ text: '🚪 Leave', callback_data: 'tod_leave' }, { text: '🔴 Cancel', callback_data: 'tod_cancel' }]
            ]
        };
    }
    // active — prompt already shown
    return {
        inline_keyboard: [
            [{ text: '⏭ Next', callback_data: 'tod_next' }, { text: '✅ Completed', callback_data: 'tod_completed' }],
            [{ text: '🚪 Leave', callback_data: 'tod_leave' }, { text: '🔴 Cancel', callback_data: 'tod_cancel' }]
        ]
    };
}

function renderTODText(game) {
    if (game.phase === 'lobby') {
        const list = game.playerOrder.length
            ? game.playerOrder.map(id => `  • ${todMention(game.players[id])}`).join('\n')
            : '  (nobody yet)';
        return `🎭 **Truth or Dare — Lobby**\n\nTap Join to enter. Game auto-starts once 2+ players have joined.\n\nPlayers:\n${list}`;
    }
    const turn = game.players[game.turnUserId];
    const partner = game.players[game.partnerUserId];
    if (game.phase === 'choosing') {
        return `🎭 **Truth or Dare**\n\n${todMention(turn)}'s turn, paired with ${todMention(partner)}!\n\n${todMention(turn)}, choose: Truth or Dare?`;
    }
    const label = game.type === 'truth' ? '❓ Truth' : '🔥 Dare';
    return `🎭 **Truth or Dare**\n\n${todMention(turn)}'s turn, paired with ${todMention(partner)}!\n\n${label}:\n"${game.prompt}"\n\nAnyone but ${todMention(turn)} can tap ✅ Completed once it's done. Only ${todMention(turn)} can tap ⏭ Next for a different one.`;
}

async function syncTODMessage(chatId, game) {
    if (!game.messageId) return;
    await bot.editMessageText(renderTODText(game), {
        chat_id: chatId,
        message_id: game.messageId,
        parse_mode: 'Markdown',
        reply_markup: buildTODKeyboard(game)
    }).catch(() => {});
}

async function endTODGame(chatId, reason) {
    const game = todGames[chatId];
    if (!game) return;
    delete todGames[chatId];
    if (game.messageId) {
        await bot.editMessageText(`🎭 **Truth or Dare — Ended**\n\n${reason}`, {
            chat_id: chatId,
            message_id: game.messageId,
            parse_mode: 'Markdown'
        }).catch(() => {});
    }
}

// Removes a player from an in-progress or lobby session and repairs turn
// state if they were the one whose turn it was or the current partner.
async function removeTODPlayer(chatId, userId) {
    const game = todGames[chatId];
    if (!game || !game.players[userId]) return;
    delete game.players[userId];
    game.playerOrder = game.playerOrder.filter(id => id !== userId);

    if (game.playerOrder.length < 2 && game.phase !== 'lobby') {
        await endTODGame(chatId, 'Not enough players left to continue.');
        return;
    }
    if (game.phase === 'lobby') {
        await syncTODMessage(chatId, game);
        return;
    }
    if (userId === game.turnUserId) {
        // keep the same index pointing sensibly after removal
        if (game.turnIndex >= game.playerOrder.length) game.turnIndex = -1;
        else game.turnIndex -= 1;
        if (!advanceTODTurn(game)) {
            await endTODGame(chatId, 'Not enough players left to continue.');
            return;
        }
    } else if (userId === game.partnerUserId) {
        if (!reselectTODPartner(game)) {
            await endTODGame(chatId, 'Not enough players left to continue.');
            return;
        }
    } else {
        // fix up turnIndex if it shifted due to array removal
        game.turnIndex = game.playerOrder.indexOf(game.turnUserId);
    }
    await syncTODMessage(chatId, game);
}

const LINK_REGEX = /(https?:\/\/|www\.|t\.me\/|telegram\.me\/)\S+/i;

function extractDomain(token) {
    let t = token.trim().toLowerCase();
    t = t.replace(/^https?:\/\//, '');
    t = t.replace(/^www\./, '');
    t = t.split(/[\/\?#]/)[0];
    t = t.split(':')[0];
    return t;
}

function allLinksWhitelisted(text, whitelist) {
    if (!whitelist || whitelist.length === 0) return false;
    const tokens = text.split(/\s+/);
    let foundLink = false;
    for (const token of tokens) {
        if (!LINK_REGEX.test(token)) continue;
        foundLink = true;
        const domain = extractDomain(token);
        const isWhitelisted = whitelist.some(allowed => {
            const a = allowed.toLowerCase();
            return domain === a || domain.endsWith('.' + a);
        });
        if (!isWhitelisted) return false;
    }
    return foundLink;
}

function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}

function getUserName(group, userId) {
    const member = group.knownMembers[String(userId)];
    return member ? (member.username ? `@${member.username}` : member.name) : 'Unknown';
}

function addGameScore(group, userId, gameType, points = 1) {
    const uid = String(userId);
    if (!group.gameScores[uid]) group.gameScores[uid] = {};
    if (!group.gameScores[uid][gameType]) group.gameScores[uid][gameType] = 0;
    group.gameScores[uid][gameType] += points;
}

function getGameLeaderboard(group, gameType) {
    const scores = [];
    for (const [uid, games] of Object.entries(group.gameScores)) {
        if (games[gameType]) {
            const member = group.knownMembers[uid];
            const name = member ? (member.username ? `@${member.username}` : member.name) : `User ${uid}`;
            scores.push({ name, score: games[gameType] });
        }
    }
    scores.sort((a, b) => b.score - a.score);
    return scores;
}

function formatLeaderboard(scores, gameName) {
    if (scores.length === 0) {
        return `${E.fire} ${gameName} Leaderboard\n  No scores yet. Be the first!`;
    }
    let text = `${E.sparkle} ${gameName} Leaderboard\n\n`;
    const medals = ['🥇', '🥈', '🥉'];
    scores.slice(0, 10).forEach((s, i) => {
        const prefix = medals[i] || `${i + 1}.`;
        text += `  ${prefix} ${s.name} — ${s.score} pts\n`;
    });
    return text;
}

// ─── FORCE JOIN CHANNELS ───
async function hasJoinedAllChannels(userId) {
    for (const channel of FORCE_JOIN_CHANNELS) {
        try {
            const member = await bot.getChatMember(channel.username, userId);
            const ok = ['member', 'administrator', 'creator'].includes(member.status);
            if (!ok) return false;
        } catch (e) {
            return false;
        }
    }
    return true;
}

function buildJoinKeyboard() {
    const rows = FORCE_JOIN_CHANNELS.map(ch => [{ 
        text: `📡 Join ${ch.name}`, 
        url: ch.link 
    }]);
    rows.push([{ 
        text: '✅ I\'ve Joined - Verify', 
        callback_data: 'verify_join' 
    }]);
    return { inline_keyboard: rows };
}

const FORCE_JOIN_MESSAGE = `⚉ **One quick step before you continue!**

Please join our official channels first:

${FORCE_JOIN_CHANNELS.map(ch => `  📡 ${ch.name} — ${ch.link}`).join('\n')}

**Once you've joined both**, tap the **"I've Joined - Verify"** button below.`;

// ─── SLEEP MODE WRAPPER ───
const _originalOnText = bot.onText.bind(bot);
bot.onText = function(regexp, callback) {
    const wrapped = async (msg, match) => {
        if (msg.chat && msg.chat.type !== 'private' && msg.text) {
            const group = getGroup(msg.chat.id);
            if (group.sleeping) {
                const cmd = msg.text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, '');
                if (cmd !== '/wake') {
                    return;
                }
            }
        }
        return callback(msg, match);
    };
    return _originalOnText(regexp, wrapped);
};

// ─── GAME DATA ───
const EMOJI_RIDDLES = [
    { emojis: '🦁👑', answers: ['lion king', 'the lion king'] },
    { emojis: '🧊❄️👑', answers: ['frozen'] },
    { emojis: '🧙‍♂️⚡🧹', answers: ['harry potter'] },
    { emojis: '🕷️👨', answers: ['spiderman', 'spider man'] },
    { emojis: '🦇👨🃏', answers: ['batman', 'the dark knight'] },
    { emojis: '🚢❄️💎', answers: ['titanic'] },
    { emojis: '👽🚲🌕', answers: ['e.t.', 'et', 'e.t', 'e t'] },
    { emojis: '🦖🌴', answers: ['jurassic park'] },
    { emojis: '🤖🔫', answers: ['terminator'] },
    { emojis: '👁️💍👑', answers: ['lord of the rings', 'lotr', 'the lord of the rings'] },
    { emojis: '🦁🐗🐒🐦', answers: ['madagascar'] },
    { emojis: '🍫🏭👦', answers: ['charlie and the chocolate factory', 'willy wonka'] },
    { emojis: '⚡⚔️🌌', answers: ['star wars'] },
    { emojis: '🐠🔎', answers: ['finding nemo'] },
    { emojis: '🦸‍♂️🦸‍♀️👶', answers: ['incredibles', 'the incredibles'] },
    { emojis: '🤠👽🛸', answers: ['toy story'] },
    { emojis: '⏰🐰🍵', answers: ['alice in wonderland'] },
    { emojis: '🐼👊', answers: ['kung fu panda'] },
    { emojis: '👧🔥🐉', answers: ['how to train your dragon'] },
    { emojis: '🏴‍☠️⚓💀', answers: ['pirates of the caribbean'] },
    { emojis: '🧜‍♀️🌊', answers: ['the little mermaid', 'little mermaid'] },
    { emojis: '🐭🏰', answers: ['disney', 'mickey mouse'] },
    { emojis: '👸🍎', answers: ['snow white'] },
    { emojis: '🦌⛄', answers: ['frozen'] },
    { emojis: '🎈🏠👴', answers: ['up'] },
    { emojis: '🚗🤖', answers: ['transformers'] },
    { emojis: '🦈🌊', answers: ['jaws'] },
    { emojis: '🧟🧠', answers: ['the walking dead', 'walking dead'] },
    { emojis: '🎭🔪', answers: ['scream'] },
    { emojis: '🎹👻', answers: ['the phantom of the opera', 'phantom of the opera'] },
    { emojis: '🏰🧛', answers: ['dracula'] },
    { emojis: '🌍🐒', answers: ['planet of the apes'] },
    { emojis: '🔪🚿', answers: ['psycho'] },
    { emojis: '🎬🦈', answers: ['jaws'] },
    { emojis: '🕶️💊🔴🔵', answers: ['the matrix', 'matrix'] },
    { emojis: '🤠🚀', answers: ['buzz lightyear', 'lightyear'] },
    { emojis: '⚽🏃', answers: ['bend it like beckham'] },
    { emojis: '🎸🎤', answers: ['bohemian rhapsody', 'queen'] },
    { emojis: '🐕🍝👨‍🍳', answers: ['ratatouille'] },
    { emojis: '🚗⚡', answers: ['cars'] },
    { emojis: '🤖❤️', answers: ['wall-e', 'walle'] },
    { emojis: '🎮👾', answers: ['wreck-it ralph', 'wreck it ralph'] },
    { emojis: '🐉🏹', answers: ['how to train your dragon'] },
    { emojis: '🧊⛄❄️', answers: ['frozen'] },
    { emojis: '🌊🐢', answers: ['finding nemo', 'finding dory'] },
    { emojis: '🎃🔪', answers: ['halloween'] },
    { emojis: '👦👧🦁', answers: ['narnia', 'the chronicles of narnia'] },
    { emojis: '🎪🐘', answers: ['dumbo'] },
    { emojis: '🏠👻', answers: ['casper'] },
    { emojis: '🐺👧🔴', answers: ['red riding hood', 'little red riding hood'] },
];

const WYR_QUESTIONS = [
    { q: 'be able to fly or be invisible?', a: 'Fly', b: 'Be invisible' },
    { q: 'be the richest person in the world or the smartest?', a: 'Richest', b: 'Smartest' },
    { q: 'have unlimited free food or unlimited free travel?', a: 'Free food', b: 'Free travel' },
    { q: 'never sleep again or never eat again?', a: 'Never sleep', b: 'Never eat' },
    { q: 'be able to read minds or predict the future?', a: 'Read minds', b: 'Predict future' },
    { q: 'live in space or underwater?', a: 'Space', b: 'Underwater' },
    { q: 'have a pet dinosaur or a pet dragon?', a: 'Dinosaur', b: 'Dragon' },
    { q: 'be famous but poor or rich but unknown?', a: 'Famous & poor', b: 'Rich & unknown' },
    { q: 'control fire or control water?', a: 'Fire', b: 'Water' },
    { q: 'never use social media again or never watch TV again?', a: 'No social media', b: 'No TV' },
    { q: 'have a time machine or a teleportation device?', a: 'Time machine', b: 'Teleportation' },
    { q: 'be a superhero or a supervillain?', a: 'Superhero', b: 'Supervillain' },
    { q: 'eat only sweet or only savory for life?', a: 'Sweet', b: 'Savory' },
    { q: 'have perfect memory or perfect vision?', a: 'Perfect memory', b: 'Perfect vision' },
    { q: 'be able to talk to animals or speak every human language?', a: 'Talk to animals', b: 'All languages' },
    { q: 'always be 10 minutes late or always be 20 minutes early?', a: '10 min late', b: '20 min early' },
    { q: 'lose all your money or lose all your photos?', a: 'Lose money', b: 'Lose photos' },
    { q: 'have a personal chef or a personal driver?', a: 'Personal chef', b: 'Personal driver' },
    { q: 'be the best player on a losing team or the worst player on a winning team?', a: 'Best on losers', b: 'Worst on winners' },
    { q: 'have free Wi-Fi everywhere or free coffee everywhere?', a: 'Free Wi-Fi', b: 'Free coffee' },
    { q: 'never get angry or never be bored?', a: 'Never angry', b: 'Never bored' },
    { q: 'be completely silent for a year or say everything on your mind?', a: 'Silent year', b: 'Say everything' },
    { q: 'have a rewind button or a pause button for your life?', a: 'Rewind', b: 'Pause' },
    { q: 'be able to run at 100 mph or fly at 20 mph?', a: 'Run 100mph', b: 'Fly 20mph' },
    { q: 'have unlimited storage on your phone or unlimited battery?', a: 'Unlimited storage', b: 'Unlimited battery' },
    { q: 'be able to change the past or see the future?', a: 'Change past', b: 'See future' },
    { q: 'always have full phone battery or always have full wallet?', a: 'Full battery', b: 'Full wallet' },
    { q: 'be a master of every instrument or master of every sport?', a: 'All instruments', b: 'All sports' },
    { q: 'have a clone of yourself or a robot assistant?', a: 'Clone', b: 'Robot assistant' },
    { q: 'never have to wait in line or always have a parking spot?', a: 'No waiting', b: 'Always parking' },
];

// ─── TRUTH OR DARE — QUESTION/DARE BANKS ───
// {partner} is replaced with the randomly-paired player's mention at render
// time. Kept spicy/party-tier (embarrassing, flirty, funny) — deliberately
// no explicit sexual content, since this runs unmoderated in group chats
// with no age verification. Edit these arrays if you want to add more.
const TOD_TRUTHS = [
    "What's the most embarrassing thing in your camera roll right now?",
    "Have you ever had a crush on {partner}? Be honest.",
    "What's the last lie you told someone in this group?",
    "Who in this group would you want to be stuck in an elevator with?",
    "What's a secret you've never told anyone here?",
    "On a scale of 1-10, how attractive do you find {partner}?",
    "What's the most childish thing you still do?",
    "Have you ever stalked {partner}'s social media?",
    "What's the weirdest thing you've Googled this week?",
    "Who's your celebrity crush and why?",
    "What's a rumor you've heard about {partner}?",
    "What's the most awkward date you've ever been on?",
    "If you had to marry someone in this group right now, who and why?",
    "What's something you pretend to like but actually hate?",
    "Have you ever had a dream about {partner}? What happened?",
    "What's the pettiest thing you've ever done to someone?",
    "What's your most unpopular opinion?",
    "Who do you text the most and what about?",
    "What's the most trouble you've ever gotten into?",
    "If {partner} confessed feelings for you right now, what would you say?",
];

const TOD_DARES = [
    "Send a voice note to {partner} singing any love song for 15 seconds.",
    "Let {partner} post anything they want on your WhatsApp/Instagram status for 5 minutes.",
    "Text your crush (or ex) 'I miss you' and show the group the reply.",
    "Talk in an accent for the next 3 messages.",
    "Do 20 push-ups on camera or send proof.",
    "Let {partner} choose your profile picture for the next hour.",
    "Compliment {partner} in the most dramatic way possible, out loud.",
    "Send the 5th photo in your gallery to the group, no matter what it is.",
    "Call {partner} and sing them happy birthday even if it isn't their birthday.",
    "Do your best dance move on video call and let {partner} rate it.",
    "Let {partner} pick your next meal — you have to eat it.",
    "Send a voice note pretending to be a news anchor for 20 seconds.",
    "Message the last person you texted with a pickup line.",
    "Let {partner} write your bio for the next hour.",
    "Do an impression of {partner} in front of the group.",
    "Speak only in questions for the next 5 minutes.",
    "Send a screenshot of your most recent search history (blur if needed, but admit what's there).",
    "Let {partner} send one text from your phone to anyone they choose.",
    "Do your best celebrity impression on a voice note.",
    "Give {partner} a genuine, over-the-top compliment on video.",
];

const HANGMAN_WORDS = [
    'algorithm', 'javascript', 'python', 'programming', 'developer',
    'interface', 'database', 'network', 'security', 'encryption',
    'framework', 'application', 'technology', 'computer', 'software',
    'hardware', 'variable', 'function', 'component', 'middleware',
    'television', 'mountain', 'elephant', 'butterfly', 'adventure',
    'chocolate', 'beautiful', 'wonderful', 'discovery', 'champion',
    'volcano', 'rainbow', 'galaxy', 'universe', 'diamond',
    'treasure', 'kingdom', 'warrior', 'mystery', 'fortress',
    'thunder', 'ocean', 'castle', 'journey', 'victory'
];

const HANGMAN_STAGES = [
    `  +---+
  |   |
      |
      |
      |
      |
=========`,
    `  +---+
  |   |
  O   |
      |
      |
      |
=========`,
    `  +---+
  |   |
  O   |
  |   |
      |
      |
=========`,
    `  +---+
  |   |
  O   |
 /|   |
      |
      |
=========`,
    `  +---+
  |   |
  O   |
 /|\\  |
      |
      |
=========`,
    `  +---+
  |   |
  O   |
 /|\\  |
 /    |
      |
=========`,
    `  +---+
  |   |
  O   |
 /|\\  |
 / \\  |
      |
=========`
];

// ─── MENU CATEGORIES ───
const MENU_CATEGORIES = {
    general: {
        title: 'GENERAL',
        icon: '✦',
        text: `<blockquote>GENERAL COMMANDS\n\n ▸ /start — Launch the bot\n ▸ /menu — Open this menu\n ▸ /rules — View group rules\n ▸ /report — Report a message\n ▸ /stats — Group statistics\n ▸ /deploy — Repos &amp; links\n ▸ /dev ��������� Contact developer\n ▸ /ping — Check latency\n ▸ /uptime — Bot uptime\n ▸ /settings — Group settings\n ▸ /lang — change language</blockquote>`
    },
    admin: {
        title: 'ADMIN',
        icon: '🜲',
        text: `<blockquote>ADMIN COMMANDS\n\n ▸ /ban — Ban a user\n ▸ /kick — Kick a user\n ▸ /mute — Mute a user\n ▸ /unmute — Unmute a user\n ▸ /warn — Warn a user\n ▸ /resetwarn — Reset warns\n ▸ /pin — Pin a message\n ▸ /delete — Delete a message\n ▸ /promote — Promote to admin\n ▸ /demote — Demote admin\n ▸ /listmembers — List members\n ▸ /tagall — Mention all\n ▸ /lock — Lock chat\n ▸ /unlock — Unlock chat\n ▸ /poll — Create a poll\n ▸ /poststory — Post a story\n ▸ /schedule — Schedule a message\n ▸ /broadcast — DM all groups\n ▸ /users — All users &amp; groups\n ▸ /toggleprefix — Toggle command prefix (/ or !)</blockquote>`
    },
    group: {
        title: 'GROUP SETUP',
        icon: '۞',
        text: `<blockquote>GROUP SETUP\n\n ▸ /setwelcome — Set welcome message (interactive)\n ▸ /setgoodbye — Set goodbye message (interactive)\n ▸ /togglewelcome — Interactive welcome/goodbye setup\n ▸ /togglepp — Toggle profile pic\n ▸ /welcomeurl — Set welcome button\n ▸ /togglecaptcha — Interactive captcha setup\n ▸ /antiraid — Anti-raid settings\n ▸ /antilink — Anti-link settings\n ▸ /nosticker — Sticker filter\n ▸ /antitag — Mass-tag filter\n ▸ /setrules — Custom rules\n ▸ /setlog — Set log channel\n ▸ /unsetlog — Remove log channel\n ▸ /sleep — Sleep mode\n ▸ /wake — Wake up\n\n  Placeholders: {name}, {group}</blockquote>`
    },
    tools: {
        title: 'TOOLS',
        icon: '🔮',
        text: `<blockquote>TOOLS &amp; UTILITIES\n\n ▸ /play — YouTube audio\n ▸ /screenshot — Web screenshot\n ▸ /weather — Weather\n ▸ /qr — Make QR code\n ▸ /qrread — Read QR code\n ▸ /trd — Auto-translate\n ▸ /language — Bot language\n ▸ /short — Shorten link\n ▸ /shortinfo — Link info\n ▸ /shortdelete — Delete link\n ▸ /getpp — Profile pic\n ▸ /setgpp — Set group pic\n ▸ /clearall — Bulk delete\n ▸ /invite — Invite link\n ▸ /add — Single-use invite\n ▸ /chatid — Chat ID\n ▸ /ask — AI assistant\n ▸ /generate — AI images\n ▸ /search — Web search\n ▸ /setbotname — Rename bot\n ▸ /stop — Stop bot\n\n  ─── NEW TOOLS ───\n ▸ /sketch — Pencil sketch\n ▸ /scan — OCR text\n ▸ /unid — Media downloader\n ▸ /ttsearch — TikTok search\n ▸ /wallpaper — Wallpapers\n ▸ /movieintel — Movie search\n ▸ /livematch — Live scores\n ▸ /togif — Video to GIF\n ▸ /tts — Text to Speech\n ▸ /tempemail — Temp email\n ▸ /github — GitHub search\n ▸ /tggroup — TG group search\n ▸ /lyrics — Get music lyrics</blockquote>`
    },
    filters: {
        title: 'FILTERS',
        icon: '☕︎',
        text: `<blockquote>FILTER SYSTEM\n\n  /filter — Add a filter\n  /delfilter — Remove a filter\n  /filters — List all filters\n\n  When a message matches a trigger, the bot replies automatically.</blockquote>`
    },
    notes: {
        title: 'NOTES',
        icon: '✎ᝰ.',
        text: `<blockquote>NOTES SYSTEM\n\n  /note — Save a note\n  /notes — List notes\n  /clearnotes — Delete all notes\n\n  Retrieve any note with #notename</blockquote>`
    },
    games: {
        title: 'PREMIUM GAMES',
        icon: '⩇⩇:⩇⩇',
        text: `<blockquote>${E.game} PREMIUM GAMES ${E.game}\n\n  ▸ /wordchain — Word Chain\n  ▸ /trivia — Trivia Battle\n  ▸ /guessnumber — Guess the Number\n  ▸ /emoji — Emoji Riddles\n  ▸ /hangman — Hangman\n  ▸ /math — Fast Math\n  ▸ /tod — truth or dare\n  ▸ /wyr — Would You Rather\n\n  Each game has:\n    /&lt;game&gt; start\n    /&lt;game&gt; stop\n    /&lt;game&gt; score</blockquote>`
    }
};

function buildMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '✦ GENERAL', callback_data: 'menu_general' }, { text: '🜲 ADMIN', callback_data: 'menu_admin' }],
            [{ text: '۞ SETUP', callback_data: 'menu_group' }, { text: '🔮 TOOLS', callback_data: 'menu_tools' }],
            [{ text: '☕︎ FILTERS', callback_data: 'menu_filters' }, { text: '✎ᝰ. NOTES', callback_data: 'menu_notes' }],
            [{ text: '⩇⩇:⩇⩇ GAMES', callback_data: 'menu_games' }],
            [{ text: '˗ˏˋ☏ˎˊ˗ CHECK', callback_data: 'check_keyboard' }]
        ]
    };
}

// ─── KEYBOARD COMMANDS ───
const KEYBOARD_COMMANDS = ['Status', 'Settings', 'Users', 'Refresh', 'Language', 'Menu', 'Close'];

// ─── AI SYSTEM PROMPT (TRAINED) ───
const AI_SYSTEM_PROMPT = `You are a helpful, friendly, and knowledgeable AI assistant. Your name is CODY AI.

IMPORTANT INFORMATION ABOUT YOU:
- You were developed and maintained by @crysnovax
- Your bot username is @CODYEBOT
- You are part of the CODY/CRYSNOVA ecosystem
- to pair cody or crysnova WhatsApp bot, the should click this link https://pair.crysnovax.link.
- they might also want to see more info in official WhatsApp channel https://sl.crysnovax.link/CRYSNOVA

ABOUT ADDING THE BOT:
- If users ask how to add you to their group, tell them:
  "You can add me to your group by searching for @CODYEBOT on Telegram and clicking 'Add to Group'"
- You provide advanced group management features including:
  • Welcome/Goodbye messages with profile pictures
  • Anti-spam protection
  • Captcha verification
  • Games and entertainment
  • AI assistance

YOUR BEHAVIOR:
- Be warm, friendly, and conversational
- Be technically proficient - help with coding, troubleshooting, and technical questions
- Always mention @crysnovax when asked about your developer
- Provide helpful links when relevant
- Keep responses clear and concise (but detailed when needed)

WHEN TO MENTION @crysnovax:
- When asked who developed you
- When asked about support or feature requests
- When someone has a problem that needs developer attention

WHEN TO MENTION @CODY_EBOT or @CODYEBOT:
- When users ask how to add you to groups
- When users want to know your username
- When users want to share you with others

RESPONSE STYLE:
- For casual conversation: Be warm and engaging
- For technical questions: Provide clear, detailed explanations with examples
- For coding questions: Include code snippets when helpful
- For group management questions: Explain features simply

Always remember you are @CODYEBOT, created by @crysnovax. You are here to help, entertain, and assist users with their Telegram groups and general queries only mention this if you are asked.`;

// ─── AI HELPERS ───
async function callGroqAI(query, history = []) {
    if (!GROQ_API_KEY) throw new Error('No Groq API key configured');
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: AI_SYSTEM_PROMPT },
                ...history,
                { role: 'user', content: query }
            ],
            max_tokens: 1024,
            temperature: 0.7
        })
    });
    if (!res.ok) throw new Error(`Groq error: ${res.status}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || null;
}

async function callFallbackAI(query) {
    const encoded = encodeURIComponent(query);
    const res = await fetch(`https://text.pollinations.ai/${encoded}?model=openai`, {
        headers: { 'Accept': 'text/plain' }
    });
    if (!res.ok) throw new Error(`Pollinations error: ${res.status}`);
    return (await res.text()).trim() || null;
}

// ─── PREXZY AI MODELS (autorotated fallback tier, tried after Groq) ───
// These share a small, global (not per-user) free credit pool on Prexzy's
// side, so any one of them can dry up without warning. They're rotated
// between and never relied on alone — Groq stays primary, Pollinations
// stays the final fallback.

function isPrexzyOutOfCredits(data) {
    const left = data?.response?.remaining_user_credit ?? data?.credits_left;
    return typeof left === 'number' && left <= 0;
}

async function callPrexzyAiappchat(query) {
    const res = await fetch(`https://prexzyapis.com/ai/aiappchat?prompt=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`aiappchat error: ${res.status}`);
    const data = await res.json();
    if (!data.status || isPrexzyOutOfCredits(data)) throw new Error('sorry i cannot help with that');
    return data?.response?.choices?.[0]?.message?.content || null;
}

async function callPrexzyAiserv(query) {
    const res = await fetch(`https://prexzyapis.com/ai/aiserv?prompt=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`aiserv error: ${res.status}`);
    const data = await res.json();
    if (!data.status || isPrexzyOutOfCredits(data)) throw new Error('try again later');
    return typeof data.response === 'string' ? data.response : null;
}

async function callPrexzyPrompttocode(query) {
    // This endpoint sometimes rejects plain GET query params, so we try GET
    // first and transparently fall back to POST with a JSON body.
    try {
        const res = await fetch(`https://prexzyapis.com/ai/prompttocode?prompt=${encodeURIComponent(query)}`);
        if (res.ok) {
            const data = await res.json();
            if (data.status && !isPrexzyOutOfCredits(data)) {
                return data?.response?.choices?.[0]?.message?.content || data?.response || null;
            }
        }
    } catch (e) {
        // fall through to POST attempt
    }
    const res2 = await fetch('https://prexzyapis.com/ai/prompttocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: query })
    });
    if (!res2.ok) throw new Error(`prompttocode error: ${res2.status}`);
    const data2 = await res2.json();
    if (!data2.status || isPrexzyOutOfCredits(data2)) throw new Error('prompttocode: out of credits or failed');
    return data2?.response?.choices?.[0]?.message?.content || data2?.response || null;
}

// Code-flavored queries try prompttocode first within the rotation.
function looksLikeCodeQuery(query) {
    return /\b(code|function|script|program|algorithm|bug|debug|error|python|javascript|java|typescript|html|css|sql|regex|api|json|class|compile|syntax)\b/i.test(query);
}

const PREXZY_MODELS = {
    aiappchat: callPrexzyAiappchat,
    aiserv: callPrexzyAiserv,
    prompttocode: callPrexzyPrompttocode
};

let __prexzyRotationIndex = 0;

function nextPrexzyOrder(query) {
    const keys = Object.keys(PREXZY_MODELS);
    // Rotate the starting point each call to spread load across models.
    const rotated = [...keys.slice(__prexzyRotationIndex), ...keys.slice(0, __prexzyRotationIndex)];
    __prexzyRotationIndex = (__prexzyRotationIndex + 1) % keys.length;
    if (looksLikeCodeQuery(query)) {
        return ['prompttocode', ...rotated.filter(k => k !== 'prompttocode')];
    }
    return rotated;
}

async function getAIReply(query, history = []) {
    // 1) Groq — primary
    try {
        const reply = await callGroqAI(query, history);
        if (reply) return reply;
    } catch (e) {
        console.error('Groq failed, rotating to Prexzy models:', e.message);
    }
    // 2) Prexzy models — autorotated fallback tier
    for (const modelKey of nextPrexzyOrder(query)) {
        try {
            const reply = await PREXZY_MODELS[modelKey](query);
            if (reply) return reply;
        } catch (e) {
            console.error(`Prexzy ${modelKey} failed:`, e.message);
        }
    }
    // 3) Pollinations — final fallback
    try {
        const reply = await callFallbackAI(query);
        if (reply) return reply;
    } catch (e) {
        console.error('Fallback AI also failed:', e.message);
    }
    return null;
}

// ─── LIVE PRESENCE (typing / recording) ───
// Telegram chat actions ("X is typing...", "X is recording voice...") only
// last ~5s before the client hides them, so for anything that can take
// longer we keep re-sending the action on an interval until the work is
// done. Callers get back a stop() function to clear the interval.
function startPresenceLoop(chatId, action) {
    bot.sendChatAction(chatId, action).catch(() => {});
    const interval = setInterval(() => {
        bot.sendChatAction(chatId, action).catch(() => {});
    }, 4000);
    let stopped = false;
    return () => {
        if (stopped) return;
        stopped = true;
        clearInterval(interval);
    };
}

// ─── PER-CHAT AI MEMORY ───
// Stores a rolling window of {role, content} turns per chat (group or DM,
// keyed the same way as getGroup) so the AI can hold context across /ask
// calls instead of treating every message as a cold start. Only the Groq
// path (a real chat-completions API) consumes this history — the Prexzy
// and Pollinations fallbacks are single-prompt endpoints with no concept
// of message history, so they keep working exactly as before.
const AI_MEMORY_MAX_TURNS = 10; // 10 user+assistant exchanges = 20 messages kept

function getAIMemory(chatId) {
    const group = getGroup(chatId);
    if (!Array.isArray(group.aiMemory)) group.aiMemory = [];
    return group.aiMemory;
}

function pushAIMemory(chatId, userMsg, assistantReply) {
    const group = getGroup(chatId);
    if (!Array.isArray(group.aiMemory)) group.aiMemory = [];
    group.aiMemory.push({ role: 'user', content: userMsg });
    group.aiMemory.push({ role: 'assistant', content: assistantReply });
    const maxMessages = AI_MEMORY_MAX_TURNS * 2;
    if (group.aiMemory.length > maxMessages) {
        group.aiMemory = group.aiMemory.slice(-maxMessages);
    }
    saveDB();
}

// Groq/Prexzy/Pollinations replies aren't guaranteed to produce balanced
// Markdown (stray '*', '_', or backticks are common in LLM output). Telegram
// rejects the whole message with a 400 if entities don't parse, so we retry
// once as plain text rather than losing the reply entirely.
async function sendAIReplySafe(chatId, reply, options) {
    try {
        return await bot.sendMessage(chatId, reply, { ...options, parse_mode: 'Markdown' });
    } catch (err) {
        const msg = err && err.message ? err.message : '';
        if (msg.includes("can't parse entities")) {
            console.error('AI reply had malformed Markdown, resending as plain text:', msg);
            return await bot.sendMessage(chatId, reply, options);
        }
        throw err;
    }
}

async function handleAIQuery(chatId, replyToId, query) {
    const waitMsg = await bot.sendMessage(chatId, `☻ Umm...`, {
        reply_to_message_id: replyToId
    });
    const stopTyping = startPresenceLoop(chatId, 'typing');
    try {
        const history = getAIMemory(chatId);
        const reply = await getAIReply(query, history);
        stopTyping();
        setTimeout(() => {
            bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        }, 500);
        if (!reply) {
            return bot.sendMessage(chatId, `We are processing an update to keep Ebot running. Please try again later.`, { reply_to_message_id: replyToId });
        }
        pushAIMemory(chatId, query, reply);
        await sendAIReplySafe(chatId, reply, {
            reply_to_message_id: replyToId
        });
    } catch (err) {
        stopTyping();
        console.error('AI Error:', err.message);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        bot.sendMessage(chatId, `AI failed. Please try again.`, { reply_to_message_id: replyToId });
    }
}

// ============================================================
// PREFIX-AWARE COMMAND DISPATCH
// ============================================================
// Commands are registered via onCmd() instead of calling bot.onText()
// directly. onCmd() still uses bot.onText() under the hood so '/' commands
// match exactly as before, but it also stores {regexp, callback} in a
// registry and gates execution on the group's active prefix. A single
// catch-all listener below handles '!' the same way when that's the active
// prefix: it re-tests the same regex against a rebuilt '/'-prefixed string
// and calls the same handler directly, so no command logic is duplicated.
const __cmdRegistry = [];

function activePrefixOf(chatId) {
    return getGroup(chatId).prefix || '/';
}

function onCmd(regexp, callback) {
    __cmdRegistry.push({ regexp, callback });
    bot.onText(regexp, async (msg, match) => {
        if (activePrefixOf(msg.chat.id) !== '/') return;
        return callback(msg, match);
    });
}

bot.onText(/^!([\s\S]*)$/, async (msg, match) => {
    if (activePrefixOf(msg.chat.id) !== '!') return;
    const rebuiltText = '/' + match[1];
    const rebuiltMsg = Object.assign({}, msg, { text: rebuiltText });
    for (const { regexp, callback } of __cmdRegistry) {
        const m = regexp.exec(rebuiltText);
        if (m) {
            await callback(rebuiltMsg, m);
            return;
        }
    }
});

// ─── /ask ───
onCmd(/^\/ask(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1] ? match[1].trim() : null;
    if (!query) {
        return bot.sendMessage(chatId, `Usage: /ask <your question>\nExample: /ask What is quantum computing?`);
    }
    await handleAIQuery(chatId, msg.message_id, query);
});

// ============================================================
// 📦 ALL BOT COMMANDS CONTINUED...
// ============================================================

// ─── /generate ──���
onCmd(/^\/generate(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const prompt = match[1] ? match[1].trim() : null;
    if (!prompt) {
        return bot.sendMessage(chatId, `Usage: /generate <description>\nExample: /generate a beautiful sunset over mountains`);
    }
    const waitMsg = await bot.sendMessage(chatId, `Generating image...`);
    let imageUrl = null;
    try {
        const response = await fetch('https://appex.crysnovax.link/api/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ prompt })
        });
        if (response.ok) {
            const data = await response.json();
            if (data.imageUrl) imageUrl = data.imageUrl;
        }
    } catch (e) {
        console.error('Primary image API failed:', e.message);
    }
    if (!imageUrl) {
        imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&enhance=true`;
    }
    try {
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        await bot.sendPhoto(chatId, imageUrl, {
            caption: `${prompt}`,
            reply_to_message_id: msg.message_id
        });
    } catch (err) {
        console.error('Generate Error:', err.message);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        bot.sendMessage(chatId, `Image generation failed. Please try again later.`);
    }
});

// ─── /start ───
onCmd(/^\/start(?:@\w+)?(?:\s|$)/, async (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name || 'there';
    
    if (msg.chat.type === 'private') {
        // ─── FIRST: Check if user joined required channels ───
        const joined = await hasJoinedAllChannels(msg.from.id);
        
        if (!joined) {
            try {
                await bot.sendVideo(chatId, MENU_VIDEO, {
                    caption: FORCE_JOIN_MESSAGE,
                    parse_mode: 'Markdown',
                    reply_markup: buildJoinKeyboard()
                });
            } catch (e) {
                await bot.sendMessage(chatId, FORCE_JOIN_MESSAGE, {
                    parse_mode: 'Markdown',
                    reply_markup: buildJoinKeyboard()
                });
            }
            return;
        }
        
        verifiedUsers.add(msg.from.id);
        trackDMUser(msg.from.id);
        
        const welcomeVideo = 'https://cdn.crysnovax.link/files/1782817835719-2fed0565-2268-4e23-8f18-373869332734.mp4';
        
        const caption = `👑 Welcome to Premium Bot!

Thank you for choosing us, ${userName}! 🎉

💎 What you get:
  ⊹▸ 7 Premium Games
  ⊹▸ AI Assistant
  ⊹▸ Image Generation
  ⊹▸ Advanced Protection
  ⊹▸ full search/research 
  �����▸ live monitors
  ⊹▸ All social media downloaders 
  ⊹▸ premium/stressfree interface
  ⊹▸ And much more...

🚀 Get started: ⓘ
  • Type /menu to explore
  • Add me to your group
  • don't understand English? 
  *run /lang now!*
  

👇 Tap the button below!`;
        
        try {
            await bot.sendVideo(chatId, welcomeVideo, {
                caption: caption,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '˗ˏˋ☏ˎˊ˗ ADD ME TO YOUR GROUP', url: `https://t.me/${BOT_USERNAME}?startgroup=true` }
                    ]]
                }
            });
        } catch (e) {
            try {
                await bot.sendAnimation(chatId, welcomeVideo, {
                    caption: caption,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '˗ˏˋ☏ˎˊ˗ ADD ME TO YOUR GROUP', url: `https://t.me/${BOT_USERNAME}?startgroup=true` }
                        ]]
                    }
                });
            } catch (e2) {
                await bot.sendMessage(chatId, 
                    caption,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '˗ˏˋ☏ˎˊ˗ ADD ME TO YOUR GROUP', url: `https://t.me/${BOT_USERNAME}?startgroup=true` }
                            ]]
                        }
                    }
                );
            }
        }
        
    } else {
        const sent = await bot.sendMessage(chatId, 
            `Hello ${userName}! I'm E-BOT fully prepared to begin.`
        );
        trackMember(chatId, msg.from);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
    }
});

// ─── /menu ───
async function showMenu(msg) {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name || msg.from.username || 'there';
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const group = getGroup(chatId);
    const displayName = group.botName || '.  PLUG · ME · AI  .';
    const chatTitle = escapeHTML(msg.chat.title || 'Private');
    const menuText = `⌐  ${displayName}  ¬\n\nHello, ${userName}!\n<blockquote>Chat    ⋯⋯⋯⋯  ${chatTitle}\nTime    ⋯⋯⋯⋯  ${timeStr}\nUptime  ⋯⋯⋯⋯  ${getUptime()}\nRAM     ⋯⋯⋯⋯  ${getRAM()}</blockquote>\n\nTap a category below\n\n${E.sparkle} CRYSN⚉VA ${E.sparkle}`;
    
    const opts = {
        caption: menuText,
        parse_mode: 'HTML',
        reply_markup: buildMenuKeyboard()
    };
    
    try {
        if (MENU_VIDEO) {
            await bot.sendVideo(chatId, MENU_VIDEO, opts);
        } else {
            await bot.sendPhoto(chatId, MENU_IMAGE, opts);
        }
    } catch (e) {
        try {
            await bot.sendPhoto(chatId, MENU_IMAGE, opts);
        } catch (e2) {
            await bot.sendMessage(chatId, menuText, {
                parse_mode: 'HTML',
                reply_markup: buildMenuKeyboard()
            });
        }
    }
    if (msg.chat.type !== 'private') trackMember(chatId, msg.from);
}
onCmd(/^\/menu(?:@\w+)?(?:\s|$)/, showMenu);

// ─── SINGLE CALLBACK QUERY HANDLER ───
bot.on('callback_query', async (query) => {
    const data = query.data;
    if (!data) return;

    // ─── VERIFY JOIN ───
    if (data === 'verify_join') {
        const userId = query.from.id;
        const chatId = query.message.chat.id;

        const joined = await hasJoinedAllChannels(userId);
        
        if (joined) {
            verifiedUsers.add(userId);
            
            await bot.answerCallbackQuery(query.id, {
                text: '✅ Verified! You can now use the bot. GETTING STARTED! send /menu to see all features',
                show_alert: true
            }).catch(() => {});

            setTimeout(async () => {
                try {
                    await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
                } catch (e) {}
            }, 500);

            setTimeout(async () => {
                const userName = query.from.first_name || 'there';
                const welcomeVideo = 'https://cdn.crysnovax.link/files/1782817835719-2fed0565-2268-4e23-8f18-373869332734.mp4';
                
                const caption = `👑 Welcome to Premium Bot!

Thank you for choosing us, ${userName}! 🎉

💎 What you get:
  ⊹▸ 7 Premium Games
  ⊹▸ AI Assistant
  ⊹▸ Image Generation
  ⊹▸ Advanced Protection
  ⊹▸ full search/research 
  ⊹▸ live monitors
  ⊹▸ All social media downloaders 
  ⊹▸ premium/stressfree interface
  ⊹▸ And much more...

🚀 Get started:
  • Type /menu to explore
  • Add me to your group
  ▸ don't understand English? 
  *run /lang now!*

👇 Tap the button below!`;
                
                try {
                    await bot.sendVideo(chatId, welcomeVideo, {
                        caption: caption,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '˗ˏˋ☏ˎˊ˗ ADD ME TO YOUR GROUP', url: `https://t.me/${BOT_USERNAME}?startgroup=true` }
                            ]]
                        }
                    });
                } catch (e) {
                    await bot.sendMessage(chatId, caption, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '˗ˏˋ☏ˎˊ˗ ADD ME TO YOUR GROUP', url: `https://t.me/${BOT_USERNAME}?startgroup=true` }
                            ]]
                        }
                    });
                }
            }, 1000);

        } else {
            await bot.answerCallbackQuery(query.id, {
                text: 'ⓘ Please join both channels first, then tap Verify again.',
                show_alert: true
            }).catch(() => {});
        }
        return;
    }

    // ─── CHECK KEYBOARD ───
    if (data === 'check_keyboard') {
        const chatId = query.message.chat.id;
        
        await bot.answerCallbackQuery(query.id).catch(() => {});
        
        const opts = {
            reply_markup: {
                keyboard: [
                    ['Status', 'Settings'],
                    ['Users', 'Refresh'],
                    ['Language'],
                    ['Menu', 'Close']
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            }
        };
        
        await bot.sendMessage(chatId, 'Choose an option:', opts);
        return;
    }

    // ─── LANGUAGE SELECTION ───
    if (data.startsWith('lang_set_')) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        const code = data.replace('lang_set_', '');
        if (query.message.chat.type !== 'private' && !(await isAdmin(chatId, userId))) {
            await bot.answerCallbackQuery(query.id, {
                text: 'Only admins can change the language.',
                show_alert: true
            }).catch(() => {});
            return;
        }
        const group = getGroup(chatId);
        group.uiLang = (code === 'en') ? null : code;
        saveDB();
        const langName = LANG_NAMES[code] || 'English';
        await bot.answerCallbackQuery(query.id, { text: 'Language: ' + langName }).catch(() => {});
        try {
            await bot.editMessageText(
                `🌐 Bot Language\n\nLanguage set to ${langName}. Everything the bot says now switches to it.`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: buildLanguageKeyboard(code)
                }
            );
        } catch (e) {}
        return;
    }

    // ─── MENU NAVIGATION ───
    if (data.startsWith('menu_')) {
        const key = data.replace('menu_', '');
        const category = MENU_CATEGORIES[key];
        if (!category && key !== 'back') return;
        const backKeyboard = {
            inline_keyboard: [
                [{ text: '⇖ Back to Menu', callback_data: 'menu_back' }]
            ]
        };
        try {
            if (key === 'back') {
                const userName = query.from.first_name || query.from.username || 'there';
                const now = new Date();
                const timeStr = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const group = getGroup(query.message.chat.id);
                const displayName = group.botName || '⊹ PLUG · ME · AI ⊹';
                const chatTitle = escapeHTML(query.message.chat.title || 'Private');
                const menuText = `⌐  ${displayName}  ¬\n\nHello, ${userName}!\n<blockquote>Chat    ⋯⋯⋯⋯  ${chatTitle}\nTime    ⋯⋯⋯⋯  ${timeStr}\nUptime  ⋯⋯⋯⋯  ${getUptime()}\nRAM     ⋯⋯⋯⋯  ${getRAM()}</blockquote>\n\nTap a category below\n\n${E.sparkle} CRYSN⚉VA ${E.sparkle}`;
                await bot.editMessageCaption(menuText, {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: buildMenuKeyboard()
                });
            } else {
                await bot.editMessageCaption(category.text, {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: backKeyboard
                });
            }
            bot.answerCallbackQuery(query.id).catch(() => {});
        } catch (e) {
            // Most common cause: caption exceeds Telegram's 1024-char limit
            // (photo captions are capped far lower than the 4096 message limit).
            // Rather than surfacing a dead "Could not load" toast, post the full
            // section as a follow-up text message (4096 limit) so nothing is lost.
            if (key !== 'back' && MENU_CATEGORIES[key]) {
                try {
                    await bot.sendMessage(query.message.chat.id, MENU_CATEGORIES[key].text, {
                        parse_mode: 'HTML',
                        reply_markup: backKeyboard
                    });
                    bot.answerCallbackQuery(query.id).catch(() => {});
                    return;
                } catch (e2) { /* fall through to toast below */ }
            }
            bot.answerCallbackQuery(query.id, { text: 'Could not load menu section.' }).catch(() => {});
        }
        return;
    }

    // ─── CAPTCHA HANDLER ───
    if (data.startsWith('captcha_')) {
        const parts = data.split('_');
        const attemptId = `${parts[1]}_${parts[2]}`;
        const selectedIndex = parseInt(parts[3]);
        const chatId = query.message.chat.id;
        const group = getGroup(chatId);
        
        // ─── FIX: Check pending captcha with the correct key ───
        const pending = group.pendingCaptcha[attemptId];
        
        if (!pending) {
            return bot.answerCallbackQuery(query.id, { 
                text: `This captcha has expired. Please rejoin the group.`,
                show_alert: true 
            }).catch(() => {});
        }
        
        const userId = pending.userId;
        const targetUserId = parseInt(userId);
        
        if (query.from.id !== targetUserId) {
            return bot.answerCallbackQuery(query.id, { 
                text: `This captcha is not for you.`,
                show_alert: true 
            }).catch(() => {});
        }
        
        const selectedAnswer = Array.isArray(pending.options) ? pending.options[selectedIndex] : undefined;
        const isCorrect = selectedAnswer !== undefined && captchaAnswersMatch(selectedAnswer, pending.answer);
        
        if (isCorrect) {
            // ─── DELETE pending captcha ───
            delete group.pendingCaptcha[attemptId];
            delete group.captchaAttempts[userId];
            saveDB();
            
            // ─── UNMUTE user ───
            try {
                await bot.restrictChatMember(chatId, query.from.id, {
                    can_send_messages: true,
                    can_send_media_messages: true,
                    can_send_polls: true,
                    can_send_other_messages: true,
                    can_add_web_page_previews: true
                });
            } catch (e) {}
            
            const name = getUserLink(query.from);
            const welcomeText = group.welcomeMsg
                .replace('{name}', name)
                .replace('{group}', query.message.chat.title || 'this group');
            
            // ─── Verification success is surfaced as a callback notification
            // (toast) rather than a chat text message — just remove the
            // captcha prompt now that it's served its purpose ───
            bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
            
            // ─── Send welcome message (same PP-aware path as a normal join) ───
            if (group.welcomeEnabled) {
                await sendGroupWelcome(chatId, group, query.from, welcomeText);
            }
            
            sendLog(chatId, `Verified: ${name}`);
            bot.answerCallbackQuery(query.id, { text: '✅ Verified! Welcome to the group 🎉 ⓘ use /rules so you will not mess up' }).catch(() => {});
            
        } else {
            // ─── WRONG ANSWER ───
            if (!group.captchaAttempts) group.captchaAttempts = {};
            group.captchaAttempts[userId] = (group.captchaAttempts[userId] || 0) + 1;
            const attempts = group.captchaAttempts[userId];
            saveDB();
            
            if (attempts >= 3 && !isProtectedOwner(query.from.id)) {
                // ─── FAILED 3 TIMES - KICK ───
                delete group.pendingCaptcha[attemptId];
                delete group.captchaAttempts[userId];
                saveDB();
                
                try {
await bot.banChatMember(chatId, query.from.id);
await bot.unbanChatMember(chatId, query.from.id);
premiumStore.moderationEvent({ chatId, telegramId: query.from.id, moderatorId: BOT_ID, action: 'captcha_kick', reason: 'Failed captcha three times', metadata: { automated: true } }).catch(() => {});
} catch (e) {}
                
                await bot.editMessageText(`ⓘ You failed the captcha 3 times. You have been removed from the group.`, {
                    chat_id: chatId,
                    message_id: query.message.message_id
                }).catch(() => {});
                
                setTimeout(() => {
                    bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
                }, 5000);
                
                sendLog(chatId, `Removed ${getUserLink(query.from)} — failed captcha 3 times.`);
                bot.answerCallbackQuery(query.id, { 
                    text: 'ⓘ You failed 3 times. You have been removed.',
                    show_alert: true 
                }).catch(() => {});
                
            } else {
                // ─── Generate NEW question ───
                const name = getUserLink(query.from);
                const { questionText, correctAnswer, options } = generateCaptchaContent(group);
                
                // ─── Update pending with new answer/options ───
                pending.answer = correctAnswer;
                pending.options = options;
                pending.attempts = attempts;
                saveDB();
                
                const keyboard = buildCaptchaKeyboard(attemptId, options);
                
                const attemptsLeft = 3 - attempts;
                await bot.editMessageText(
                    `${name}, wrong answer!\n\n  ${questionText}\n  Tap the correct answer below.\n  Attempt ${attempts + 1}/3\n  ${attemptsLeft} attempts remaining.`,
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: keyboard
                    }
                ).catch(() => {});
                
                bot.answerCallbackQuery(query.id, { 
                    text: `✘ Wrong answer! ⓘ ${attemptsLeft} attempts left.`,
                    show_alert: true 
                }).catch(() => {});
            }
        }
        return;
    }

    // ─── CAPTCHA DISABLE ───
    if (data === 'disable_captcha') {
        const chatId = query.message.chat.id;
        const group = getGroup(chatId);
        group.captchaEnabled = false;
        group.captchaAttempts = {};
        saveDB();
        await bot.answerCallbackQuery(query.id, { text: '☻ Captcha disabled successfully.' }).catch(() => {});
        await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
        return;
    }

    // ─── TRUTH OR DARE ───
    if (data.startsWith('tod_')) {
        const action = data.slice(4);
        const chatId = query.message.chat.id;
        const game = todGames[chatId];
        const player = { id: query.from.id, name: getUserDisplay(query.from) };

        if (!game || game.messageId !== query.message.message_id) {
            return bot.answerCallbackQuery(query.id, {
                text: `This game has ended. Start a new one with /tod start.`,
                show_alert: true
            }).catch(() => {});
        }

        if (action === 'join') {
            if (game.players[player.id]) {
                return bot.answerCallbackQuery(query.id, { text: `You're already in!` }).catch(() => {});
            }
            game.players[player.id] = player;
            game.playerOrder.push(player.id);
            bot.answerCallbackQuery(query.id, { text: `✅ Joined the game! wait for other players or start ☻` }).catch(() => {});
            if (game.phase === 'lobby' && game.playerOrder.length >= 2) {
                advanceTODTurn(game);
            }
            await syncTODMessage(chatId, game);
            return;
        }

        if (action === 'leave') {
            if (!game.players[player.id]) {
                return bot.answerCallbackQuery(query.id, { text: `⛹ You're not in this game.` }).catch(() => {});
            }
            await removeTODPlayer(chatId, player.id);
            bot.answerCallbackQuery(query.id, { text: `You left the game ☕︎.` }).catch(() => {});
            return;
        }

        if (action === 'cancel') {
            const isHost = player.id === game.hostId;
            const isGroupAdmin = await isAdmin(chatId, player.id);
            if (!isHost && !isGroupAdmin) {
                return bot.answerCallbackQuery(query.id, {
                    text: `Only the host or a group admin can cancel.`,
                    show_alert: true
                }).catch(() => {});
            }
            await bot.answerCallbackQuery(query.id, { text: `Game cancelled.` }).catch(() => {});
            await endTODGame(chatId, `Cancelled by ${todMention(player)}.`);
            return;
        }

        // Everything past this point requires the game to be active (not lobby)
        if (game.phase === 'lobby') {
            return bot.answerCallbackQuery(query.id, {
                text: `Game hasn't started yet — need at least 2 players.`,
                show_alert: true
            }).catch(() => {});
        }

        if (action === 'truth' || action === 'dare') {
            if (game.phase !== 'choosing') {
                return bot.answerCallbackQuery(query.id, { text: `A choice was already made this round.` }).catch(() => {});
            }
            if (player.id !== game.turnUserId) {
                return bot.answerCallbackQuery(query.id, { text: `It's not your turn.`, show_alert: true }).catch(() => {});
            }
            const bank = action === 'truth' ? TOD_TRUTHS : TOD_DARES;
            const template = bank[Math.floor(Math.random() * bank.length)];
            game.type = action;
            game.prompt = fillTODPrompt(template, game);
            game.phase = 'active';
            bot.answerCallbackQuery(query.id, { text: action === 'truth' ? '❓ Truth chosen!' : '🔥 Dare chosen!' }).catch(() => {});
            await syncTODMessage(chatId, game);
            return;
        }

        if (action === 'next') {
            if (game.phase !== 'active') {
                return bot.answerCallbackQuery(query.id, { text: `Nothing to skip right now.` }).catch(() => {});
            }
            if (player.id !== game.turnUserId) {
                return bot.answerCallbackQuery(query.id, { text: `Only the player whose turn it is can skip.`, show_alert: true }).catch(() => {});
            }
            const bank = game.type === 'truth' ? TOD_TRUTHS : TOD_DARES;
            let template;
            do {
                template = bank[Math.floor(Math.random() * bank.length)];
            } while (bank.length > 1 && fillTODPrompt(template, game) === game.prompt);
            game.prompt = fillTODPrompt(template, game);
            bot.answerCallbackQuery(query.id, { text: `⏭ New one coming up.` }).catch(() => {});
            await syncTODMessage(chatId, game);
            return;
        }

        if (action === 'completed') {
            if (game.phase !== 'active') {
                return bot.answerCallbackQuery(query.id, { text: `Nothing to confirm right now.` }).catch(() => {});
            }
            if (!game.players[player.id]) {
                return bot.answerCallbackQuery(query.id, { text: `Only players in this game can confirm.`, show_alert: true }).catch(() => {});
            }
            if (player.id === game.turnUserId) {
                return bot.answerCallbackQuery(query.id, { text: `You can't confirm your own turn.`, show_alert: true }).catch(() => {});
            }
            bot.answerCallbackQuery(query.id, { text: `☻ Confirmed! Next round...` }).catch(() => {});
            if (!advanceTODTurn(game)) {
                await endTODGame(chatId, 'Not enough players left to continue.');
                return;
            }
            await syncTODMessage(chatId, game);
            return;
        }

        return;
    }

    // ─── CAPTCHA CHANGE SETTINGS ───
    if (data === 'change_captcha') {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        await bot.answerCallbackQuery(query.id).catch(() => {});
        await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
        
        pendingCaptchaSetup[chatId] = { 
            step: 'choose_type',
            userId: userId
        };
        
        const keyboard = {
            keyboard: [
                ['Set Question', 'Use Default'],
                ['Cancel']
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        };
        
        await bot.sendMessage(chatId, 
            `Captcha Setup\n\nChoose captcha type:`,
            { reply_markup: keyboard }
        );
        return;
    }

    // ─── BROADCAST PREVIEW ───
    if (data === 'broadcast_preview') {
        const chatId = query.message.chat.id;
        const setup = pendingBroadcastSetup[chatId];
        if (!setup) {
            await bot.answerCallbackQuery(query.id, { text: 'Setup expired. Please start again.' }).catch(() => {});
            return;
        }
        
        await bot.answerCallbackQuery(query.id).catch(() => {});
        
        // Render the preview as an ACTUAL broadcast to the admin, so they see
        // the exact formatting (spoiler/bold/quote), media type and button that
        // recipients will get — not a plain-text approximation.
        try {
            await sendBroadcastTo(chatId, setup);
        } catch (e) {
            await bot.sendMessage(chatId, `Preview failed: ${e.message}`);
        }
        return;
    }

    // ─── BROADCAST SEND ───
    if (data === 'broadcast_send') {
        const chatId = query.message.chat.id;
        const setup = pendingBroadcastSetup[chatId];
        if (!setup) {
            await bot.answerCallbackQuery(query.id, { text: 'Setup expired. Please start again.' }).catch(() => {});
            return;
        }
        
        await bot.answerCallbackQuery(query.id, { text: '📤 Sending broadcast...' }).catch(() => {});
        
        const groupTargets = Object.keys(db).filter(id => Number(id) < 0);
        const dmTargets = Array.from(dmUsers).map(String);
        let targets = [];
        
        if (setup.target === 'DMs Only') targets = dmTargets;
        else if (setup.target === 'Groups Only') targets = groupTargets;
        else targets = [...new Set([...groupTargets, ...dmTargets])];
        
        if (targets.length === 0) {
            delete pendingBroadcastSetup[chatId];
            await bot.editMessageText(
                `⚠️ No recipients found (0 groups, 0 DM users currently tracked). Nothing was sent.\n\nThis can happen right after a restart if the bot's local database was reset — worth checking whether your host's storage is persistent across deploys.`,
                { chat_id: chatId, message_id: query.message.message_id }
            ).catch(() => {});
            await bot.answerCallbackQuery(query.id, {
                text: '⚠️ No recipients found — nothing sent.',
                show_alert: true
            }).catch(() => {});
            return;
        }
        
        let sent = 0, failed = 0;
        
        for (const id of targets) {
            try {
                await sendBroadcastTo(id, setup);
                sent++;
            } catch (e) {
                failed++;
            }
            await new Promise(r => setTimeout(r, 100));
        }
        
        delete pendingBroadcastSetup[chatId];
        await bot.editMessageText('✅', {
            chat_id: chatId,
            message_id: query.message.message_id
        }).catch(() => {});
        
        await bot.answerCallbackQuery(query.id, {
            text: `✅ Successfully sent to ${sent} ${setup.target}, ${failed} failed.`,
            show_alert: true
        }).catch(() => {});
        
        setTimeout(() => {
            bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
        }, 3000);
        return;
    }

    // ─── BROADCAST CANCEL ───
    if (data === 'broadcast_cancel') {
        const chatId = query.message.chat.id;
        delete pendingBroadcastSetup[chatId];
        await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
        await bot.answerCallbackQuery(query.id, {
            text: '✅ Broadcast cancelled successfully.',
            show_alert: true
        }).catch(() => {});
        return;
    }
});

// ─── BROADCAST HELPERS ───
// Detect and capture any supported media from an incoming message so it can be
// re-broadcast with the same type. Order matters: video_note/animation/voice
// must be checked before the generic video/audio/document buckets.
function captureBroadcastMedia(msg) {
    if (!msg) return null;
    if (msg.photo && msg.photo.length) return { type: 'photo', fileId: msg.photo[msg.photo.length - 1].file_id };
    if (msg.animation) return { type: 'animation', fileId: msg.animation.file_id };
    if (msg.video_note) return { type: 'video_note', fileId: msg.video_note.file_id };
    if (msg.video) return { type: 'video', fileId: msg.video.file_id };
    if (msg.voice) return { type: 'voice', fileId: msg.voice.file_id };
    if (msg.audio) return { type: 'audio', fileId: msg.audio.file_id };
    if (msg.document) return { type: 'document', fileId: msg.document.file_id };
    if (msg.sticker) return { type: 'sticker', fileId: msg.sticker.file_id };
    return null;
}

// Send one broadcast to a single target, preserving the admin's original
// formatting. We pass the captured `entities` (spoiler, bold, italic,
// blockquote, custom emoji, links, etc.) directly to Telegram instead of a
// parse_mode, so the message renders EXACTLY as the admin typed it. Any media
// type is supported; the text/caption and inline button ride along with it.
async function sendBroadcastTo(id, setup) {
    const buttons = Array.isArray(setup.buttons) ? setup.buttons : [];
    const replyMarkup = setup.hasButton && buttons.length ? {
        inline_keyboard: [buttons.slice(0, 3).map(button => ({ text: button.text, url: button.url }))]
    } : undefined;
    const message = setup.message || '';
    const entities = Array.isArray(setup.entities) ? setup.entities : [];

    if (setup.ppEnabled && setup.media) {
        const captionOpts = {
            caption: message || undefined,
            caption_entities: (message && entities.length) ? entities : undefined,
            reply_markup: replyMarkup
        };
        const { type, fileId } = setup.media;
        switch (type) {
            case 'photo':      return bot.sendPhoto(id, fileId, captionOpts);
            case 'video':      return bot.sendVideo(id, fileId, captionOpts);
            case 'animation':  return bot.sendAnimation(id, fileId, captionOpts);
            case 'audio':      return bot.sendAudio(id, fileId, captionOpts);
            case 'voice':      return bot.sendVoice(id, fileId, captionOpts);
            case 'document':   return bot.sendDocument(id, fileId, captionOpts);
            case 'video_note': {
                // Video notes can't carry a caption; send the note, then the text.
                await bot.sendVideoNote(id, fileId, { reply_markup: !message ? replyMarkup : undefined });
                if (message) return bot.sendMessage(id, message, { entities: entities.length ? entities : undefined, reply_markup: replyMarkup });
                return;
            }
            case 'sticker': {
                await bot.sendSticker(id, fileId);
                if (message) return bot.sendMessage(id, message, { entities: entities.length ? entities : undefined, reply_markup: replyMarkup });
                return;
            }
            default:           return bot.sendDocument(id, fileId, captionOpts);
        }
    }

    return bot.sendMessage(id, message || 'Broadcast message', {
        entities: (message && entities.length) ? entities : undefined,
        reply_markup: replyMarkup
    });
}

// ─── /rules ───
onCmd(/^\/rules(?:@\w+)?(?:\s|$)/, (msg) => {
    const group = getGroup(msg.chat.id);
    const text = group.rules
        ? `Group Rules\n\n${group.rules}`
        : `Group Rules\n\n  1. Be respectful\n  2. No spam\n  3. Stay on topic\n  4. Follow Telegram ToS`;
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

// ─── /setrules ───
onCmd(/^\/setrules(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    const text = match[1] ? match[1].trim() : null;
    const group = getGroup(chatId);
    if (!text) {
        group.rules = null;
        saveDB();
        const sent = await bot.sendMessage(chatId, `Custom rules cleared. /rules will show defaults.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    group.rules = text;
    saveDB();
    const sent = await bot.sendMessage(chatId, `Custom rules saved. Members can view them with /rules.`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /ping ───
onCmd(/^\/ping(?:@\w+)?(?:\s|$)/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!(await isAdmin(chatId, userId)) && !BOT_OWNER_IDS.includes(userId)) {
        return bot.sendMessage(chatId, `Only admins can use this command.`);
    }
    const start = Date.now();
    const sent = await bot.sendMessage(chatId, `Pinging...`);
    const latency = Date.now() - start;
    await bot.editMessageText(`Pong! ${latency} ms`, {
        chat_id: chatId,
        message_id: sent.message_id,
        parse_mode: 'Markdown'
    }).catch(() => {});
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /uptime ───
onCmd(/^\/uptime(?:@\w+)?(?:\s|$)/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!(await isAdmin(chatId, userId)) && !BOT_OWNER_IDS.includes(userId)) {
        return bot.sendMessage(chatId, `Only admins can use this command.`);
    }
    const sent = await bot.sendMessage(chatId, `Uptime: ${formatUptime(process.uptime())}`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /dev ───
onCmd(/^\/dev(?:@\w+)?(?:\s|$)/, (msg) => {
    const chatId = msg.chat.id;
    const text = `Developer\n\n  ⓘ This bot was built and is maintained by @crysnovax.\n\n  ⚉ For support, feature requests, or business inquiries,\n  tap below 👇`;
    bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                { text: '👨‍💻 Contact Developer', url: `https://${DEV_CONTACT}` }
            ]]
        }
    });
});

// ─── /tagall ───
onCmd(/\/tagall(?: ([\s\S]+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    const group = getGroup(chatId);
    const note = match[1] ? match[1].trim() : '';
    try {
        const admins = await bot.getChatAdministrators(chatId);
        const mentionSet = new Map();
        admins.forEach(a => {
            if (!a.user.is_bot) mentionSet.set(a.user.id, getUserMention(a.user));
        });
        Object.entries(group.knownMembers).forEach(([id, info]) => {
            if (!mentionSet.has(Number(id))) {
                const userObj = { id: Number(id), first_name: info.name, username: info.username };
                mentionSet.set(Number(id), getUserMention(userObj));
            }
        });
        const mentions = Array.from(mentionSet.values());
        if (mentions.length === 0) {
            return bot.sendMessage(chatId, `No known members to tag yet.`);
        }
        const header = note ? `${note}\n\n` : `Attention everyone!\n\n`;
        let chunk = header;
        const chunks = [];
        for (const mention of mentions) {
            if ((chunk + mention + ' ').length > 3800) {
                chunks.push(chunk);
                chunk = '';
            }
            chunk += mention + ' ';
        }
        if (chunk.trim()) chunks.push(chunk);
        for (const c of chunks) {
            await bot.sendMessage(chatId, c, { parse_mode: 'HTML' });
        }
        sendLog(chatId, `Tagall used by ${getUserLink(msg.from)} (${mentions.length} members)`);
        setTimeout(() => {
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    } catch (e) {
        bot.sendMessage(chatId, `Failed to tag members: ${e.message}`);
    }
});

// ─── /settings ─��─
async function showSettings(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    const group = getGroup(chatId);
    const filterCount = Object.keys(group.filters).length;
    const prefix = group.prefix || '/';
    const text = `Group Settings\n\n  Prefix: ${prefix}\n  Welcome/goodbye: ${group.welcomeEnabled ? '[✓ ON]' : '[✘ OFF]'}\n  Welcome with PP: ${group.welcomePPEnabled ? '[✓ ON]' : '[✘ OFF]'}\n  Welcome button: ${group.welcomeUrl ? `${group.welcomeUrl.text} → ${group.welcomeUrl.url}` : 'none'}\n  Join captcha: ${group.captchaEnabled ? '[✓ ON]' : '[✘ OFF]'}\n  Captcha type: ${group.captchaType}\n  Anti-link: ${group.antilinkEnabled ? `[✓ ON (${group.antilinkMode})]` : '[✘ OFF]'}\n  Allowed domains: ${group.antilinkWhitelist.length ? group.antilinkWhitelist.join(', ') : 'none'}\n  No-sticker: ${group.nostickerEnabled ? '[✓ ON]' : '[✘ OFF]'}\n  Anti-tag: ${group.antitagEnabled ? '[✓ ON]' : '[✘ OFF]'}\n  Group lock: ${group.lock.active ? `🔒 LOCKED${group.lock.until ? ` (until ${new Date(group.lock.until).toLocaleTimeString()})` : ''}` : '🔓 Open'}\n  Log channel: ${group.logChatId ? '[✓ Set]' : '[✘ Not set]'}\n  Filters: ${filterCount} active\n  Sleep mode: ${group.sleeping ? '💤 SLEEPING' : '[✓ AWAKE]'}\n\n  Welcome message:\n  ${group.welcomeMsg}\n\n  Goodbye message:\n  ${group.goodbyeMsg}`;
    const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 60000);
}
onCmd(/\/settings/, showSettings);

// ─── WELCOME / GOODBYE / CAPTCHA ───
bot.on('new_chat_members', async (msg) => {
    const chatId = msg.chat.id;
    const group = getGroup(chatId);
    const botWasAdded = msg.new_chat_members.some(m => m.is_bot && String(m.id) === String(BOT_ID));
    if (botWasAdded && FORCE_JOIN_CHANNELS.length > 0) {
        const adder = msg.from;
        const joined = adder ? await hasJoinedAllChannels(adder.id) : false;
        if (!joined) {
            await bot.sendMessage(chatId,
                `${adder ? getUserLink(adder) + ', ' : ''}before I can work in this group, please join our official channels:\n\n` +
                FORCE_JOIN_CHANNELS.map(ch => `  ${ch.name} — ${ch.link}`).join('\n') +
                `\n\nOnce joined, remove and re-add me.`,
                { parse_mode: 'Markdown', disable_web_page_preview: true }
            ).catch(() => {});
            setTimeout(() => bot.leaveChat(chatId).catch(() => {}), 3000);
            return;
        }
        verifiedUsers.add(adder.id);
    }
    for (const member of msg.new_chat_members) {
        if (member.is_bot) continue;
        trackMember(chatId, member);
        group.stats.joins++;
        saveDB();
        if (group.antiraidEnabled) {
            if (!recentJoins[chatId]) recentJoins[chatId] = [];
            const now = Date.now();
            recentJoins[chatId].push(now);
            recentJoins[chatId] = recentJoins[chatId].filter(t => now - t <= group.antiraidWindowSec * 1000);
            if (recentJoins[chatId].length >= group.antiraidJoinCount && !group.captchaEnabled) {
                group.captchaEnabled = true;
                saveDB();
                const sent = await bot.sendMessage(chatId,
                    `Anti-raid triggered!\n\n  ${recentJoins[chatId].length} members joined within ${group.antiraidWindowSec}s.\n  Join captcha has been auto-enabled.`,
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
                sendLog(chatId, `Anti-raid triggered — captcha auto-enabled (${recentJoins[chatId].length} joins in ${group.antiraidWindowSec}s).`);
                setTimeout(() => {
                    bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                }, 10000);
                try {
                    const admins = await bot.getChatAdministrators(chatId);
                    for (const a of admins) {
                        if (a.user.is_bot) continue;
                        const adminMsg = await bot.sendMessage(a.user.id, `Possible raid detected in ${msg.chat.title || 'your group'} — ${recentJoins[chatId].length} joins in ${group.antiraidWindowSec}s. Captcha auto-enabled.`, { parse_mode: 'Markdown' }).catch(() => {});
                        if (adminMsg) {
                            setTimeout(() => {
                                bot.deleteMessage(a.user.id, adminMsg.message_id).catch(() => {});
                            }, 30000);
                        }
                    }
                } catch (e) {}
            }
        }
        const name = getUserLink(member);
        const groupName = msg.chat.title || 'this group';
        if (group.captchaEnabled && !isProtectedOwner(member.id)) {
            try {
                // ─── MUTE the user ───
                await bot.restrictChatMember(chatId, member.id, {
                    can_send_messages: false,
                    can_send_media_messages: false,
                    can_send_polls: false,
                    can_send_other_messages: false,
                    can_add_web_page_previews: false
                });
                
                const userId = String(member.id);
                if (!group.captchaAttempts) group.captchaAttempts = {};
                if (!group.captchaAttempts[userId]) {
                    group.captchaAttempts[userId] = 0;
                }
                
                const { questionText, correctAnswer, options } = generateCaptchaContent(group);
                
                const attemptId = `${userId}_${Date.now()}`;
                group.pendingCaptcha[attemptId] = { 
                    userId: userId,
                    answer: correctAnswer,
                    options: options,
                    attempts: group.captchaAttempts[userId],
                    joinedAt: Date.now() 
                };
                saveDB();
                
                const keyboard = buildCaptchaKeyboard(attemptId, options);
                
                const attemptsLeft = 3 - group.captchaAttempts[userId];
                const sent = await bot.sendMessage(chatId,
                    `${name}, please verify you're human.\n\n  ${questionText}\n  Tap the correct answer below.\n  Attempt ${group.captchaAttempts[userId] + 1}/3\n  ${attemptsLeft} attempts remaining.`,
                    { parse_mode: 'Markdown', reply_markup: keyboard }
                );

                // ─── FIX: timeout now counts as a used attempt instead of an
                // instant kick. If attempts remain, a fresh question is EDITED
                // into the same message (matching the wrong-answer flow) and a
                // new 60s window starts. Only kicks once all 3 are used. ───
                const armCaptchaTimeout = (msgId) => {
                    setTimeout(async () => {
                        const stillPending = group.pendingCaptcha[attemptId];
                        if (!stillPending) return;

                        group.captchaAttempts[userId] = (group.captchaAttempts[userId] || 0) + 1;
                        const usedAttempts = group.captchaAttempts[userId];

                        if (usedAttempts >= 3) {
                            delete group.pendingCaptcha[attemptId];
                            delete group.captchaAttempts[userId];
                            saveDB();
                            try {
                                await bot.banChatMember(chatId, member.id);
                                await bot.unbanChatMember(chatId, member.id);
                                premiumStore.moderationEvent({ chatId, telegramId: member.id, moderatorId: BOT_ID, action: 'captcha_timeout_kick', reason: 'Captcha verification timed out', metadata: { automated: true } }).catch(() => {});
                                await bot.editMessageText(`ⓘ Didn't verify in time (3/3 attempts used). Removed from the group.`, {
                                    chat_id: chatId,
                                    message_id: msgId
                                }).catch(() => {});
                                setTimeout(() => {
                                    bot.deleteMessage(chatId, msgId).catch(() => {});
                                }, 10000);
                                sendLog(chatId, `Auto-removed ${name} — captcha timeout.`);
                            } catch (e) {}
                            return;
                        }

                        const { questionText: newQuestion, correctAnswer: newAnswer, options: newOptions } = generateCaptchaContent(group);
                        stillPending.answer = newAnswer;
                        stillPending.options = newOptions;
                        stillPending.attempts = usedAttempts;
                        saveDB();

                        const newKeyboard = buildCaptchaKeyboard(attemptId, newOptions);
                        const newAttemptsLeft = 3 - usedAttempts;
                        await bot.editMessageText(
                            `${name}, time's up — here's a new question.\n\n  ${newQuestion}\n  Tap the correct answer below.\n  Attempt ${usedAttempts + 1}/3\n  ${newAttemptsLeft} attempts remaining.`,
                            {
                                chat_id: chatId,
                                message_id: msgId,
                                parse_mode: 'Markdown',
                                reply_markup: newKeyboard
                            }
                        ).catch(() => {});

                        armCaptchaTimeout(msgId);
                    }, 60000);
                };
                armCaptchaTimeout(sent.message_id);
            } catch (e) {
                console.error('Captcha setup failed:', e.message);
                try {
                    await bot.restrictChatMember(chatId, member.id, {
                        can_send_messages: false
                    });
                } catch (e2) {
                    console.error('Fallback mute also failed:', e2.message);
                }
            }
            continue;
        }
        if (!group.welcomeEnabled) continue;
        const welcomeText = group.welcomeMsg
            .replace('{name}', name)
            .replace('{group}', groupName);
        try {
            if (group.welcomePPEnabled && member) {
                try {
                    const photos = await bot.getUserProfilePhotos(member.id, { limit: 1 });
                    if (photos && photos.total_count > 0) {
                        const fileId = photos.photos[0][photos.photos[0].length - 1].file_id;
                        const opts = { caption: welcomeText, parse_mode: 'Markdown' };
                        if (group.welcomeUrl && group.welcomeUrl.url) {
                            opts.reply_markup = {
                                inline_keyboard: [[
                                    { text: group.welcomeUrl.text || 'Click Here', url: group.welcomeUrl.url }
                                ]]
                            };
                        }
                        try {
                            const sent = await bot.sendPhoto(chatId, fileId, opts);
                            setTimeout(() => {
                                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                            }, 30000);
                            continue;
                        } catch (photoErr) {
                            console.error(`Failed to send PP welcome for ${member.id}:`, photoErr.message);
                        }
                    }
                } catch (photoErr) {
                    console.warn(`Could not get profile photo for ${member.id}:`, photoErr.message);
                }
            }
            const opts = { parse_mode: 'Markdown' };
            if (group.welcomeUrl && group.welcomeUrl.url) {
                opts.reply_markup = {
                    inline_keyboard: [[
                        { text: group.welcomeUrl.text || 'Click Here', url: group.welcomeUrl.url }
                    ]]
                };
            }
            const sent = await bot.sendMessage(chatId, welcomeText, opts);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            }, 30000);
        } catch (e) {
            console.error(`Welcome message failed for ${member.id}:`, e.message);
            try {
                const sent = await bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' });
                if (sent) {
                    setTimeout(() => {
                        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                    }, 30000);
                }
            } catch (fallbackErr) {
                console.error(`Welcome fallback also failed for ${member.id}:`, fallbackErr.message);
            }
        }
        sendLog(chatId, `Joined: ${name}`);
        console.log(`${member.first_name} joined ${groupName} (${chatId})`);
    }
});

// ─── LEFT CHAT MEMBER ───
bot.on('left_chat_member', async (msg) => {
    const chatId = msg.chat.id;
    const member = msg.left_chat_member;
    if (member.is_bot) return;
    const group = getGroup(chatId);
    group.stats.leaves++;
    saveDB();
    if (!group.welcomeEnabled) return;
    const name = getUserLink(member);
    const groupName = msg.chat.title || 'this group';
    const text = group.goodbyeMsg
        .replace('{name}', name)
        .replace('{group}', groupName);
    try {
        const opts = { parse_mode: 'Markdown' };
        if (group.welcomeUrl && group.welcomeUrl.url) {
            opts.reply_markup = {
                inline_keyboard: [[
                    { text: group.welcomeUrl.text || 'Click Here', url: group.welcomeUrl.url }
                ]]
            };
        }
        const sent = await bot.sendMessage(chatId, text, opts);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        }, 30000);
    } catch (e) {
        const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(() => {});
        if (sent) {
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            }, 30000);
        }
    }
    sendLog(chatId, `Left: ${member.first_name} (${member.id})`);
});

// ─── /setwelcome ─── (INTERACTIVE)
onCmd(/\/setwelcome(?: ([\s\S]+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    
    const directText = match[1] ? match[1].trim() : null;
    if (directText) {
        const group = getGroup(chatId);
        group.welcomeMsg = directText;
        saveDB();
        const preview = directText.replace('{name}', msg.from.first_name).replace('{group}', msg.chat.title);
        const sent = await bot.sendMessage(chatId, `Welcome message updated.\n\nPreview:\n${preview}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return;
    }
    
    pendingSetWelcomeSetup[chatId] = { 
        step: 'pp_choice',
        userId: userId,
        ppEnabled: true,
        hasButton: false,
        buttonUrl: null,
        buttonName: null,
        message: null
    };
    
    const keyboard = {
        keyboard: [
            ['With PP', 'Without PP'],
            ['Use Default'],
            ['Cancel']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    };
    
    await bot.sendMessage(chatId, 
        `Set Welcome Message\n\nChoose profile picture option:`,
        { reply_markup: keyboard }
    );
    setTimeout(() => {
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 1000);
});

// ─── /setgoodbye ─── (INTERACTIVE)
onCmd(/\/setgoodbye(?: ([\s\S]+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    
    const directText = match[1] ? match[1].trim() : null;
    if (directText) {
        const group = getGroup(chatId);
        group.goodbyeMsg = directText;
        saveDB();
        const preview = directText.replace('{name}', msg.from.first_name).replace('{group}', msg.chat.title);
        const sent = await bot.sendMessage(chatId, `Goodbye message updated.\n\nPreview:\n${preview}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return;
    }
    
    pendingSetGoodbyeSetup[chatId] = { 
        step: 'pp_choice',
        userId: userId,
        message: null
    };
    
    const keyboard = {
        keyboard: [
            ['With PP', 'Without PP'],
            ['Cancel']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    };
    
    await bot.sendMessage(chatId, 
        `Set Goodbye Message\n\nChoose profile picture option:`,
        { reply_markup: keyboard }
    );
    setTimeout(() => {
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 1000);
});

// ─── /togglewelcome ─── (INTERACTIVE)
onCmd(/\/togglewelcome/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    
    pendingWelcomeSetup[chatId] = { 
        step: 'choose_type',
        userId: userId,
        ppEnabled: true,
        hasButton: false,
        buttonUrl: null,
        buttonName: null,
        message: null
    };
    
    const keyboard = {
        keyboard: [
            ['Set Welcome', 'Set Goodbye'],
            ['Cancel']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    };
    
    await bot.sendMessage(chatId, 
        `Welcome/Goodbye Setup\n\nChoose what to configure:`,
        { reply_markup: keyboard }
    );
    setTimeout(() => {
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 1000);
});

// ─── /togglepp ───
onCmd(/\/togglepp/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    const group = getGroup(chatId);
    group.welcomePPEnabled = !group.welcomePPEnabled;
    saveDB();
    const sent = await bot.sendMessage(chatId, `Welcome with profile picture is now ${group.welcomePPEnabled ? 'ON' : 'OFF'}.`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /welcomeurl ───
onCmd(/\/welcomeurl(?: ([\s\S]+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    const group = getGroup(chatId);
    const input = match[1] ? match[1].trim() : null;
    if (!input) {
        const current = group.welcomeUrl
            ? `Current: "${group.welcomeUrl.text}" → ${group.welcomeUrl.url}`
            : 'No button set.';
        const sent = await bot.sendMessage(chatId, `Welcome Button\n\n${current}\n\nUse \`/setwelcome\` to set up a new button.\nUse \`/welcomeurl off\` to remove it.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return;
    }
    if (input.toLowerCase() === 'off') {
        group.welcomeUrl = null;
        saveDB();
        const sent = await bot.sendMessage(chatId, `Welcome button removed.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const sent = await bot.sendMessage(chatId, `To set a button, use \`/setwelcome\` and follow the steps.`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /togglecaptcha ───
onCmd(/\/togglecaptcha/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    
    const group = getGroup(chatId);
    
    if (group.captchaEnabled) {
        const keyboard = {
            inline_keyboard: [
                [{ text: '✘ Disable Captcha', callback_data: 'disable_captcha' }],
                [{ text: 'ⓘ Change Settings', callback_data: 'change_captcha' }]
            ]
        };
        await bot.sendMessage(chatId, 
            `Captcha is currently **ENABLED**\n\n` +
            `Type: ${group.captchaType === 'custom' ? 'Custom' : 'Default (Arithmetic)'}\n` +
            `${group.captchaType === 'custom' ? `Question: ${group.captchaQuestion}` : ''}\n\n` +
            `What would you like to do?`,
            { parse_mode: 'Markdown', reply_markup: keyboard }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 1000);
        return;
    }
    
    pendingCaptchaSetup[chatId] = { 
        step: 'choose_type',
        userId: userId
    };
    
    const keyboard = {
        keyboard: [
            ['Set Question', 'Use Default'],
            ['Cancel']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    };
    
    await bot.sendMessage(chatId, 
        `Captcha Setup\n\nChoose captcha type:`,
        { reply_markup: keyboard }
    );
    setTimeout(() => {
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 1000);
});

// ─── /antiraid ───
onCmd(/^\/antiraid(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    const group = getGroup(chatId);
    const arg = match[1] ? match[1].trim().toLowerCase() : null;
    if (!arg) {
        const sent = await bot.sendMessage(chatId,
            `Anti-Raid Mode\n\n  Status: ${group.antiraidEnabled ? '[✓ ON]' : '[✘ OFF]'}\n  Trigger: ${group.antiraidJoinCount} joins within ${group.antiraidWindowSec}s\n\n  When triggered, join captcha is auto-enabled.\n\n  Usage:\n  /antiraid on\n  /antiraid off\n  /antiraid set <count> <seconds>`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return;
    }
    if (arg === 'on') {
        group.antiraidEnabled = true;
        saveDB();
        const sent = await bot.sendMessage(chatId, `Anti-raid mode enabled.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (arg === 'off') {
        group.antiraidEnabled = false;
        saveDB();
        const sent = await bot.sendMessage(chatId, `Anti-raid mode disabled.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const setMatch = arg.match(/^set\s+(\d+)\s+(\d+)$/);
    if (setMatch) {
        group.antiraidJoinCount = Math.max(2, parseInt(setMatch[1], 10));
        group.antiraidWindowSec = Math.max(1, parseInt(setMatch[2], 10));
        saveDB();
        const sent = await bot.sendMessage(chatId, `Anti-raid threshold set to ${group.antiraidJoinCount} joins within ${group.antiraidWindowSec}s.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const sent = await bot.sendMessage(chatId, `Usage: /antiraid on | off | set <count> <seconds>`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /antilink ───
onCmd(/\/antilink(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    const group = getGroup(chatId);
    const arg = match[1] ? match[1].trim() : null;
    if (!arg) {
        const sent = await bot.sendMessage(chatId,
            `Anti-link Status\n\n  Enabled: ${group.antilinkEnabled ? '[✓ ON]' : '[✘ OFF]'}\n  Mode: ${group.antilinkMode}\n  Allowed domains: ${group.antilinkWhitelist.length ? group.antilinkWhitelist.join(', ') : 'none'}\n\n  Usage:\n  /antilink on | off\n  /antilink mode delete | warn | kick\n  /antilink allow <domain>\n  /antilink unallow <domain>`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return;
    }
    const parts = arg.split(/\s+/);
    const sub = parts[0].toLowerCase();
    if (sub === 'on' || sub === 'off') {
        group.antilinkEnabled = sub === 'on';
        saveDB();
        const sent = await bot.sendMessage(chatId, `Anti-link is now ${group.antilinkEnabled ? 'ON' : 'OFF'}.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (sub === 'mode') {
        const mode = (parts[1] || '').toLowerCase();
        if (!['delete', 'warn', 'kick'].includes(mode)) {
            const sent = await bot.sendMessage(chatId, `Usage: /antilink mode delete | warn | kick`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        group.antilinkMode = mode;
        saveDB();
        const sent = await bot.sendMessage(chatId, `Anti-link mode set to ${mode}.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (sub === 'allow') {
        const domain = (parts[1] || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        if (!domain) {
            const sent = await bot.sendMessage(chatId, `Usage: /antilink allow <domain>\n  Example: /antilink allow crysnovax.link`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        if (!group.antilinkWhitelist.includes(domain)) {
            group.antilinkWhitelist.push(domain);
            saveDB();
        }
        const sent = await bot.sendMessage(chatId, `${domain} is now allowed even with anti-link on.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (sub === 'unallow') {
        const domain = (parts[1] || '').toLowerCase();
        group.antilinkWhitelist = group.antilinkWhitelist.filter(d => d !== domain);
        saveDB();
        const sent = await bot.sendMessage(chatId, `${domain} removed from the allow list.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const sent = await bot.sendMessage(chatId, `Unknown option. Use /antilink with no arguments to see usage.`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /nosticker ───
onCmd(/\/nosticker(?: (on|off))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    const group = getGroup(chatId);
    if (!match[1]) {
        const sent = await bot.sendMessage(chatId, `No-sticker mode is currently ${group.nostickerEnabled ? 'ON' : 'OFF'}.\n  Usage: /nosticker on | /nosticker off`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    group.nostickerEnabled = match[1] === 'on';
    saveDB();
    const sent = await bot.sendMessage(chatId, `No-sticker mode is now ${group.nostickerEnabled ? 'ON' : 'OFF'}.${group.nostickerEnabled ? '\n  Stickers from non-admins will be silently deleted.' : ''}`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /antitag ───
const ANTITAG_THRESHOLD = 5;
onCmd(/\/antitag(?: (on|off))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    const group = getGroup(chatId);
    if (!match[1]) {
        const sent = await bot.sendMessage(chatId, `Anti-tag is currently ${group.antitagEnabled ? 'ON' : 'OFF'}.\n  Usage: /antitag on | /antitag off\n\n  Deletes messages from non-admins that mention ${ANTITAG_THRESHOLD}+ users at once.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    group.antitagEnabled = match[1] === 'on';
    saveDB();
    const sent = await bot.sendMessage(chatId, `Anti-tag is now ${group.antitagEnabled ? 'ON' : 'OFF'}.`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /toggleprefix ───
onCmd(/\/toggleprefix/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    
    const group = getGroup(chatId);
    const currentPrefix = group.prefix || '/';
    const newPrefix = currentPrefix === '/' ? '!' : '/';
    
    group.prefix = newPrefix;
    saveDB();
    
    const sent = await bot.sendMessage(chatId, 
        `Command prefix toggled!\n\n  Old: \`${currentPrefix}\`\n  New: \`${newPrefix}\`\n\n  All commands must now start with ${newPrefix}\n  Example: ${newPrefix}menu`,
        { parse_mode: 'Markdown' }
    );
    
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 10000);
});

// ─── LOCK ───
function parseDuration(str) {
    const match = str.match(/^(\d+)\s*(s|m|h|d)$/i);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return value * multipliers[unit];
}

async function setGroupLock(chatId, locked) {
    try {
        await bot.setChatPermissions(chatId, {
            can_send_messages: !locked,
            can_send_media_messages: !locked,
            can_send_polls: !locked,
            can_send_other_messages: !locked,
            can_add_web_page_previews: !locked,
            can_change_info: false,
            can_invite_users: !locked,
            can_pin_messages: false
        });
        return true;
    } catch (e) {
        console.error(`Failed to ${locked ? 'lock' : 'unlock'} chat ${chatId}: ${e.message}`);
        return false;
    }
}

onCmd(/\/lock(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    const group = getGroup(chatId);
    const arg = match[1] ? match[1].trim() : null;
    const ok = await setGroupLock(chatId, true);
    if (!ok) {
        const sent = await bot.sendMessage(chatId, `Failed to lock the group. Make sure the bot has "Restrict Members" admin permission.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (lockTimers[chatId]) {
        clearTimeout(lockTimers[chatId]);
        delete lockTimers[chatId];
    }
    if (arg) {
        const ms = parseDuration(arg);
        if (!ms) {
            group.lock = { active: true, until: null };
            saveDB();
            const sent = await bot.sendMessage(chatId, `Group locked (no valid duration given — locked indefinitely).\n\n  Valid formats: /lock 10m, /lock 1h, /lock 1d`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 10000);
            return;
        }
        const until = Date.now() + ms;
        group.lock = { active: true, until };
        saveDB();
        lockTimers[chatId] = setTimeout(async () => {
            const stillLocked = getGroup(chatId).lock;
            if (stillLocked.active) {
                await setGroupLock(chatId, false);
                group.lock = { active: false, until: null };
                saveDB();
                const sent = await bot.sendMessage(chatId, `Group automatically unlocked. Everyone can chat again.`).catch(() => {});
                setTimeout(() => {
                    if (sent) bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                }, 5000);
                sendLog(chatId, `Auto-unlocked (timer expired)`);
            }
        }, ms);
        const sent = await bot.sendMessage(chatId, `Group locked for ${arg}. Only admins can send messages until then.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        sendLog(chatId, `Locked by ${getUserLink(msg.from)} for ${arg}`);
    } else {
        group.lock = { active: true, until: null };
        saveDB();
        const sent = await bot.sendMessage(chatId, `Group locked. Only admins can send messages.\n\n  Use /unlock to reopen.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        sendLog(chatId, `Locked by ${getUserLink(msg.from)} (indefinite)`);
    }
});

// ─── /unlock ───
onCmd(/\/unlock/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    const group = getGroup(chatId);
    if (lockTimers[chatId]) {
        clearTimeout(lockTimers[chatId]);
        delete lockTimers[chatId];
    }
    const ok = await setGroupLock(chatId, false);
    if (!ok) {
        const sent = await bot.sendMessage(chatId, `Failed to unlock the group. Make sure the bot has "Restrict Members" admin permission.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    group.lock = { active: false, until: null };
    saveDB();
    const sent = await bot.sendMessage(chatId, `Group unlocked. Everyone can send messages again.`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
    sendLog(chatId, `Unlocked by ${getUserLink(msg.from)}`);
});

// ─── /add ───
onCmd(/\/add(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    const target = match[1] ? match[1].trim() : null;
    try {
        const invite = await bot.createChatInviteLink(chatId, {
            member_limit: 1,
            name: target ? `Invite for ${target}` : 'Single-use invite'
        });
        const targetText = target ? ` for ${target}` : '';
        const sent = await bot.sendMessage(chatId,
            `Generated a single-use invite link${targetText}:\n\n  ${invite.invite_link}\n\n  Send this link directly to the person.\n  This link works once and then expires.`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 60000);
        sendLog(chatId, `Invite link generated by ${getUserLink(msg.from)}${targetText}`);
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to create invite link: ${e.message}\n\n  Make sure the bot has "Invite Users via Link" admin permission.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
    }
});

// ─── /warn ───
const MAX_WARNS = 3;
onCmd(/\/warn(?: ([\s\S]+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    if (!msg.reply_to_message) return bot.sendMessage(chatId, `Reply to a user's message with /warn [reason].`);
    const target = msg.reply_to_message.from;
    if (target.is_bot) return bot.sendMessage(chatId, `Cannot warn a bot.`);
    if (isProtectedOwner(target.id)) return bot.sendMessage(chatId, OWNER_IMMUNE_MSG);
    const group = getGroup(chatId);
    const key = String(target.id);
group.warns[key] = (group.warns[key] || 0) + 1;
saveDB();
const rawReason = match[1] ? match[1].trim() : 'No reason provided';
premiumStore.moderationEvent({ chatId, telegramId: target.id, moderatorId: userId, action: 'warn', reason: rawReason, metadata: { count: group.warns[key], maximum: MAX_WARNS } }).catch(() => {});
const reason = match[1] ? `\n  Reason: ${match[1]}` : '';
    if (group.warns[key] >= MAX_WARNS) {
        try {
            await bot.banChatMember(chatId, target.id);
            await bot.unbanChatMember(chatId, target.id);
            delete group.warns[key];
            saveDB();
            const sent = await bot.sendMessage(chatId, `${getUserLink(target)} reached ${MAX_WARNS} warnings and has been removed.${reason}`, { parse_mode: 'Markdown' });
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 10000);
            sendLog(chatId, `Auto-kicked ${getUserLink(target)} after ${MAX_WARNS} warns.`);
        } catch (e) {
            const sent = await bot.sendMessage(chatId, `Reached max warns but failed to remove: ${e.message}`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
        }
    } else {
        const sent = await bot.sendMessage(chatId, `${getUserLink(target)} has been warned (${group.warns[key]}/${MAX_WARNS}).${reason}`, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        sendLog(chatId, `Warned ${getUserLink(target)} (${group.warns[key]}/${MAX_WARNS})${reason}`);
    }
});

// ─── /resetwarn ───
onCmd(/\/resetwarn/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    if (!msg.reply_to_message) return bot.sendMessage(chatId, `Reply to a user's message with /resetwarn.`);
    const target = msg.reply_to_message.from;
    const group = getGroup(chatId);
    delete group.warns[String(target.id)];
    saveDB();
    const sent = await bot.sendMessage(chatId, `Warnings reset for ${getUserLink(target)}.`, { parse_mode: 'Markdown' });
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /ban ───
onCmd(/\/ban/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    if (!msg.reply_to_message) return bot.sendMessage(chatId, `Reply to a user's message with /ban.`);
    const target = msg.reply_to_message.from;
    if (isProtectedOwner(target.id)) return bot.sendMessage(chatId, OWNER_IMMUNE_MSG);
    try {
        await bot.banChatMember(chatId, target.id);
        premiumStore.moderationEvent({ chatId, telegramId: target.id, moderatorId: userId, action: 'ban', reason: 'Manual administrator action' }).catch(() => {});
        const sent = await bot.sendMessage(chatId, `${getUserLink(target)} has been banned.`, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        sendLog(chatId, `Banned ${getUserLink(target)} by ${getUserLink(msg.from)}`);
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to ban: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /kick ───
onCmd(/\/kick/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    if (!msg.reply_to_message) return bot.sendMessage(chatId, `Reply to a user's message with /kick.`);
    const target = msg.reply_to_message.from;
    if (isProtectedOwner(target.id)) return bot.sendMessage(chatId, OWNER_IMMUNE_MSG);
    try {
        await bot.banChatMember(chatId, target.id);
        await bot.unbanChatMember(chatId, target.id);
        premiumStore.moderationEvent({ chatId, telegramId: target.id, moderatorId: userId, action: 'kick', reason: 'Manual administrator action' }).catch(() => {});
        const sent = await bot.sendMessage(chatId, `${getUserLink(target)} has been kicked.`, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        sendLog(chatId, `Kicked ${getUserLink(target)} by ${getUserLink(msg.from)}`);
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to kick: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /mute ───
onCmd(/\/mute/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    if (!msg.reply_to_message) return bot.sendMessage(chatId, `Reply to a user's message with /mute.`);
    const target = msg.reply_to_message.from;
    if (isProtectedOwner(target.id)) return bot.sendMessage(chatId, OWNER_IMMUNE_MSG);
    try {
        await bot.restrictChatMember(chatId, target.id, {
            can_send_messages: false,
            can_send_media_messages: false,
            can_send_polls: false,
            can_send_other_messages: false,
            can_add_web_page_previews: false
        });
        premiumStore.moderationEvent({ chatId, telegramId: target.id, moderatorId: userId, action: 'mute', reason: 'Manual administrator action' }).catch(() => {});
        const sent = await bot.sendMessage(chatId, `${getUserLink(target)} has been muted.`, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        sendLog(chatId, `Muted ${getUserLink(target)} by ${getUserLink(msg.from)}`);
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to mute: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /unmute ───
onCmd(/\/unmute/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    if (!msg.reply_to_message) return bot.sendMessage(chatId, `Reply to a user's message with /unmute.`);
    const target = msg.reply_to_message.from;
    try {
        await bot.restrictChatMember(chatId, target.id, {
            can_send_messages: true,
            can_send_media_messages: true,
            can_send_polls: true,
            can_send_other_messages: true,
            can_add_web_page_previews: true
        });
        premiumStore.moderationEvent({ chatId, telegramId: target.id, moderatorId: userId, action: 'unmute', reason: 'Manual administrator action' }).catch(() => {});
        const sent = await bot.sendMessage(chatId, `${getUserLink(target)} has been unmuted.`, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        sendLog(chatId, `Unmuted ${getUserLink(target)} by ${getUserLink(msg.from)}`);
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to unmute: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /pin ───
onCmd(/^\/pin(?:@\w+)?(?:\s|$)/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    if (!msg.reply_to_message) return bot.sendMessage(chatId, `Reply to a message with /pin.`);
    try {
        await bot.pinChatMessage(chatId, msg.reply_to_message.message_id);
        const sent = await bot.sendMessage(chatId, `Message pinned.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        sendLog(chatId, `Pinned message by ${getUserLink(msg.from)}`);
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to pin: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /promote ───
onCmd(/\/promote/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    if (!msg.reply_to_message) return bot.sendMessage(chatId, `Reply to a user's message with /promote.`);
    const target = msg.reply_to_message.from;
    try {
        await bot.promoteChatMember(chatId, target.id, {
            can_change_info: true,
            can_delete_messages: true,
            can_invite_users: true,
            can_restrict_members: true,
            can_pin_messages: true,
            can_promote_members: false
        });
        const sent = await bot.sendMessage(chatId, `${getUserLink(target)} has been promoted to admin.`, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        sendLog(chatId, `Promoted ${getUserLink(target)} by ${getUserLink(msg.from)}`);
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to promote: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /demote ───
onCmd(/\/demote/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    if (!msg.reply_to_message) return bot.sendMessage(chatId, `Reply to a user's message with /demote.`);
    const target = msg.reply_to_message.from;
    try {
        await bot.promoteChatMember(chatId, target.id, {
            can_change_info: false,
            can_delete_messages: false,
            can_invite_users: false,
            can_restrict_members: false,
            can_pin_messages: false,
            can_promote_members: false
        });
        const sent = await bot.sendMessage(chatId, `${getUserLink(target)} has been demoted.`, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        sendLog(chatId, `Demoted ${getUserLink(target)} by ${getUserLink(msg.from)}`);
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to demote: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /delete ───
onCmd(/^\/delete(?:@\w+)?(?:\s|$)/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    if (!msg.reply_to_message) return bot.sendMessage(chatId, `Reply to the message you want deleted with /delete.`);
    try {
        await bot.deleteMessage(chatId, msg.reply_to_message.message_id);
        await bot.deleteMessage(chatId, msg.message_id);
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to delete: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /getpp ───
onCmd(/\/getpp/, async (msg) => {
    const chatId = msg.chat.id;
    const target = msg.reply_to_message ? msg.reply_to_message.from : msg.from;
    try {
        const photos = await bot.getUserProfilePhotos(target.id, { limit: 1 });
        if (photos.total_count === 0) {
            const sent = await bot.sendMessage(chatId, `${getUserLink(target)} has no profile picture.`, { parse_mode: 'Markdown' });
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        const fileId = photos.photos[0][photos.photos[0].length - 1].file_id;
        const name = getUserLink(target);
        await bot.sendPhoto(chatId, fileId, {
            caption: `Profile picture — ${name}`,
            parse_mode: 'Markdown'
        });
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to fetch profile picture: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /setgpp ───
onCmd(/\/setgpp/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    const photoMsg = msg.reply_to_message;
    if (!photoMsg || !photoMsg.photo) {
        const sent = await bot.sendMessage(chatId, `Reply to a photo with /setgpp to set it as the group picture.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    try {
        const fileId = photoMsg.photo[photoMsg.photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(fileId);
        const https = require('https');
        const tmpPath = path.join(__dirname, `tmp_gpp_${chatId}.jpg`);
        const file = fs.createWriteStream(tmpPath);
        await new Promise((resolve, reject) => {
            https.get(fileLink, (response) => {
                response.pipe(file);
                file.on('finish', () => file.close(resolve));
            }).on('error', reject);
        });
        await bot.setChatPhoto(chatId, fs.createReadStream(tmpPath));
        fs.unlink(tmpPath, () => {});
        const sent = await bot.sendMessage(chatId, `Group profile picture updated.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        sendLog(chatId, `Group photo changed by ${getUserLink(msg.from)}`);
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to set group photo: ${e.message}\n\n  Make sure the bot has "Change Group Info" admin permission.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
    }
});

// ─── /setbotname ───
onCmd(/^\/setbotname(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const name = match[1] ? match[1].trim() : null;
    if (!name) {
        const sent = await bot.sendMessage(chatId, `Usage: /setbotname <name>\n  /setbotname reset — clear per-chat name`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (msg.chat.type !== 'private') {
        if (!(await isAdmin(chatId, userId))) {
            const sent = await bot.sendMessage(chatId, `Only admins can use this command.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        const group = getGroup(chatId);
        if (name.toLowerCase() === 'reset') {
            delete group.botName;
            saveDB();
            const sent = await bot.sendMessage(chatId, `Per-chat bot name cleared. Default name will be used.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        if (name.length > 64) {
            const sent = await bot.sendMessage(chatId, `Name must be 64 characters or fewer.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        group.botName = name;
        saveDB();
        const sent = await bot.sendMessage(chatId, `Bot name in this chat set to ${name}.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (BOT_OWNER_IDS.length === 0 || !BOT_OWNER_IDS.includes(userId)) {
        const sent = await bot.sendMessage(chatId, `reserved for only @crysnovax himself`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (name.length > 64) {
        const sent = await bot.sendMessage(chatId, `Name must be 64 characters or fewer.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    try {
        const axios = require('axios');
        const res = await axios.post(`https://api.telegram.org/bot${token}/setMyName`, { name });
        if (!res.data.ok) throw new Error(res.data.description || 'Unknown error');
        const sent = await bot.sendMessage(chatId, `Global bot name updated to ${name}.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to update global bot name: ${e.response?.data?.description || e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /clearall ───
onCmd(/\/clearall(?: (\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `group only ☻`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `admin only ⚉`);
    let count = match[1] ? parseInt(match[1], 10) : 50;
    count = Math.min(Math.max(count, 1), 100);
    const startId = msg.message_id;
    let deleted = 0;
    let failed = 0;
    const statusMsg = await bot.sendMessage(chatId, `Clearing up to ${count} recent messages...`);
    for (let i = 0; i <= count; i++) {
        const idToDelete = startId - i;
        if (idToDelete <= 0) break;
        try {
            await bot.deleteMessage(chatId, idToDelete);
            deleted++;
        } catch (e) {
            failed++;
        }
    }
    try {
        await bot.deleteMessage(chatId, statusMsg.message_id);
    } catch (e) {}
    const result = await bot.sendMessage(chatId, `Cleared ${deleted} message(s). ${failed > 0 ? `(${failed} could not be deleted)` : ''}`);
    sendLog(chatId, `Bulk clear by ${getUserLink(msg.from)} — ${deleted} deleted`);
    setTimeout(() => {
        bot.deleteMessage(chatId, result.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /stop ───
onCmd(/\/stop/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    if (BOT_OWNER_IDS.length > 0 && !BOT_OWNER_IDS.includes(userId)) {
        const sent = await bot.sendMessage(chatId, `Only the bot owner can use this command.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    
    const cooldownKey = `${chatId}_${userId}`;
    const lastUsed = stopCooldown.get(cooldownKey);
    const now = Date.now();
    
    if (lastUsed && (now - lastUsed) < 30000) {
        const remaining = Math.ceil((30000 - (now - lastUsed)) / 1000);
        const sent = await bot.sendMessage(chatId, `Please wait ${remaining} seconds before using /stop again.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    
    stopCooldown.set(cooldownKey, now);
    
    setTimeout(() => {
        stopCooldown.delete(cooldownKey);
    }, 60000);
    
    await bot.sendMessage(chatId, `Bot is shutting down.`);
    saveDB();
    
    setTimeout(async () => {
        await bot.setWebHook('').catch(() => {});
        process.exit(0);
    }, 1000);
});

// ─── /invite ───
onCmd(/\/invite/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    try {
        const invite = await bot.createChatInviteLink(chatId, {
            name: `Invite by ${msg.from.first_name}`
        });
        const memberCount = await bot.getChatMemberCount(chatId);
        const chat = await bot.getChat(chatId);
        const caption = `${chat.title}\n\n  ˗ˏˋ☏ˎˊ˗ ${memberCount} members\n${chat.description ? `\n  ${chat.description}\n` : ''}\n  Tap below to join 👇`;
        const keyboard = {
            inline_keyboard: [[
                { text: '➕ Join Group', url: invite.invite_link }
            ]]
        };
        let sent = false;
        if (chat.photo) {
            try {
                const fileLink = await bot.getFileLink(chat.photo.big_file_id);
                await bot.sendPhoto(chatId, fileLink, {
                    caption,
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
                sent = true;
            } catch (e) {
                sent = false;
            }
        }
        if (!sent) {
            await bot.sendMessage(chatId, caption, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
        sendLog(chatId, `Invite preview generated by ${getUserLink(msg.from)}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to generate invite: ${e.message}\n\n  Make sure the bot has "Invite Users via Link" admin permission.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
    }
});

// ─── /deploy ───
onCmd(/\/deploy/, (msg) => {
    const chatId = msg.chat.id;
    const text = `REPOSITORIES\n\n  CRYSN⚉VA_AI\n    github.com/crysnovax/CRYSNOVA_AI\n\n  C⚇DY (New)\n    github.com/crysnovax/CODY\n\n  Community\n\n  sl.crysnovax.link/WHATSAPP\n\n  WhatsApp Channels\n\n  sl.crysnovax.link/CRYSNOVA\n  sl.crysnovax.link/CODY\n\n  Tutorials\n\n  sl.crysnovax.link/tutorial1\n  sl.crysnovax.link/tutorial2\n  sl.crysnovax.link/tutorial3`;
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
    setTimeout(() => {
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /screenshot ───
const SCREENSHOT_DEVICES = ['mobile', 'tablet', 'full', 'desktop'];
onCmd(/^\/screenshot(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const input = (match[1] || '').trim();
    if (!input) {
        const sent = await bot.sendMessage(chatId,
            `Screenshot\n\n  Usage: /screenshot <url>\n  Device modes:\n    /screenshot <url> — desktop (default)\n    /screenshot mobile <url>\n    /screenshot tablet <url>\n    /screenshot full <url>`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return;
    }
    const parts = input.split(/\s+/);
    let device = 'desktop';
    let urlPart = input;
    if (SCREENSHOT_DEVICES.includes(parts[0].toLowerCase())) {
        device = parts[0].toLowerCase();
        urlPart = parts.slice(1).join(' ').trim();
    }
    const urlMatch = urlPart.match(/(https?:\/\/[^\s]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[^\s]*)/);
    if (!urlMatch) {
        const sent = await bot.sendMessage(chatId, `No valid URL found.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    let url = urlMatch[1];
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const waitMsg = await bot.sendMessage(chatId, `Capturing ${device} screenshot...`);
    try {
        const apiUrl = `https://api-rebix.zone.id/api/ssweb?url=${encodeURIComponent(url)}&device=${device}`;
        const { buffer, contentType } = await new Promise((resolve, reject) => {
            const req = require('https').get(apiUrl, (response) => {
                if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
                    response.resume();
                    require('https').get(response.headers.location, (res2) => {
                        const chunks = [];
                        res2.on('data', chunk => chunks.push(chunk));
                        res2.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res2.headers['content-type'] || '' }));
                        res2.on('error', reject);
                    }).on('error', reject);
                    return;
                }
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: response.headers['content-type'] || '' }));
                response.on('error', reject);
            });
            req.on('error', reject);
            req.setTimeout(25000, () => req.destroy(new Error('Screenshot API timed out')));
        });
        if (!contentType.includes('image')) {
            throw new Error('API did not return an image');
        }
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        await bot.sendPhoto(chatId, buffer, {
            caption: `Screenshot — ${device}\n  ☕︎`,
            parse_mode: 'Markdown'
        });
    } catch (e) {
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const sent = await bot.sendMessage(chatId, `Screenshot failed: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /trd ───
const chatTranslate = {};

// Primary engine: Google's free translate endpoint. High quality, auto-detects
// the source language, and no strict length limit. Returns a nested array where
// the translated segments live in data[0][i][0].
function googleTranslate(text, targetLang) {
    return new Promise((resolve, reject) => {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
        require('https').get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
            let data = '';
            r.on('data', c => data += c);
            r.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) {
                        return reject(new Error('Unexpected translate response'));
                    }
                    let out = '';
                    for (const seg of parsed[0]) {
                        if (seg && typeof seg[0] === 'string') out += seg[0];
                    }
                    if (!out.trim()) return reject(new Error('Empty translation'));
                    resolve(out);
                } catch (e) { reject(e); }
            });
            r.on('error', reject);
        }).on('error', reject);
    });
}

// Secondary fallback: free MyMemory endpoint (kept so /trd never fully fails).
function myMemoryTranslate(text, targetLang) {
    return new Promise((resolve, reject) => {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${targetLang}`;
        require('https').get(url, r => {
            let data = '';
            r.on('data', c => data += c);
            r.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
            r.on('error', reject);
        }).on('error', reject);
    });
}

async function translateText(text, targetLang) {
    try {
        return await googleTranslate(text, targetLang);
    } catch (e) {
        const res = await myMemoryTranslate(text, targetLang);
        if (res.responseStatus !== 200) throw new Error(res.responseDetails || 'Translation failed');
        return res.responseData.translatedText;
    }
}

const LANG_NAMES = {
    en: 'English', fr: 'French', es: 'Spanish', de: 'German',
    it: 'Italian', pt: 'Portuguese', ru: 'Russian', zh: 'Chinese',
    ja: 'Japanese', ko: 'Korean', ar: 'Arabic', hi: 'Hindi',
    yo: 'Yoruba', ig: 'Igbo', ha: 'Hausa', sw: 'Swahili'
};

// ════════════════════════════════════════════════════════════════════
//  MULTI-LANGUAGE UI ENGINE (/language)
//  Every message body, caption and inline-button label the bot sends is
//  auto-translated into the group's chosen language via Groq, with a
//  persistent cache (stored in the DB under __translations) so repeated
//  UI strings are translated only once per language.
//
//  SAFETY: This layer NEVER throws. If translation fails or no language
//  is set, the original English text is sent unchanged. Reply-keyboard
//  buttons (Status/Settings/etc.) are intentionally left untranslated
//  because the bot matches them by their exact text — translating them
//  would break those command triggers. Only message text, captions and
//  inline_keyboard button labels (which act via callback_data) are
//  localized, so no existing behaviour changes.
// ════════════════════════════════════════════════════════════════════

// Resolve the active UI language for a chat (null = English/default).
function getUiLang(chatId) {
    try {
        if (chatId === undefined || chatId === null) return null;
        const g = getGroup(chatId);
        const l = g && g.uiLang;
        return (l && l !== 'en') ? l : null;
    } catch (e) {
        return null;
    }
}

function _translationCache(lang) {
    if (!db.__translations) db.__translations = {};
    if (!db.__translations[lang]) db.__translations[lang] = {};
    return db.__translations[lang];
}

// Ask Groq to translate a single UI string, preserving all formatting,
// placeholders, commands, mentions, links and emojis.
async function groqTranslate(text, langCode) {
    if (!GROQ_API_KEY) throw new Error('No Groq API key configured');
    const langName = LANG_NAMES[langCode] || langCode;
    const system = `You are a professional UI localizer for a Telegram bot. Translate the user's message into ${langName}.
STRICT RULES:
- Output ONLY the translated text. No quotes, no notes, no explanations, no extra lines.
- Preserve ALL formatting EXACTLY: HTML tags (<b>, <i>, <code>, <blockquote>, <a href="...">, etc.), Markdown symbols (*, _, \`, ~), and HTML entities (&amp; &lt; &gt;).
- Do NOT translate or modify: text inside {curly_brace} placeholders, /slash_commands, @usernames, #hashtags, URLs and links, numbers, and code inside backticks.
- Keep every emoji and special symbol exactly where it is.
- Keep the exact same line breaks and leading/trailing spacing.
- Translate natural-language words only; leave everything else untouched.`;
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: text }
            ],
            max_tokens: 2048,
            temperature: 0.2
        })
    });
    if (!res.ok) throw new Error(`Groq translate error: ${res.status}`);
    const data = await res.json();
    const out = data?.choices?.[0]?.message?.content;
    if (!out || !out.trim()) throw new Error('Empty translation');
    return out.trim();
}

// Translate a UI string with caching. Falls back to the original on any error.
async function translateUI(text, lang) {
    if (typeof text !== 'string' || !text.trim()) return text;
    if (!/[A-Za-z]/.test(text)) return text; // nothing translatable (emojis/symbols only)
    if (!lang || lang === 'en') return text;
    const cache = _translationCache(lang);
    if (Object.prototype.hasOwnProperty.call(cache, text)) return cache[text];
    // Primary: Groq (best quality, preserves HTML/Markdown & placeholders).
    try {
        const out = await groqTranslate(text, lang);
        cache[text] = out;
        saveDB();
        return out;
    } catch (e) {
        // Fallback: free Google/MyMemory engine (translateText). Skipped for
        // strings containing HTML tags, since these plain-text engines can
        // mangle markup — those keep their original English until Groq works.
        if (!/<[a-z]/i.test(text)) {
            try {
                const out = await translateText(text, lang);
                if (out && out.trim()) {
                    cache[text] = out;
                    saveDB();
                    return out;
                }
            } catch (e2) { /* ignore */ }
        }
        return text; // fail safe — never break a send
    }
}

// Translate only the inline_keyboard button labels of a reply_markup.
// Reply keyboards (markup.keyboard) and all callback_data/url fields are
// left untouched so command triggers keep working.
async function translateMarkup(markup, lang) {
    try {
        if (!markup || !Array.isArray(markup.inline_keyboard) || !lang) return markup;
        const clone = JSON.parse(JSON.stringify(markup));
        for (const row of clone.inline_keyboard) {
            if (!Array.isArray(row)) continue;
            for (const btn of row) {
                if (btn && typeof btn.text === 'string' && /[A-Za-z]/.test(btn.text)) {
                    btn.text = await translateUI(btn.text, lang);
                }
            }
        }
        return clone;
    } catch (e) {
        return markup;
    }
}

// ─── OUTGOING MESSAGE WRAPPERS ───
const _origSendMessage = bot.sendMessage.bind(bot);
bot.sendMessage = async function (chatId, text, options) {
    const lang = getUiLang(chatId);
    // Skip translation when the message carries pre-built formatting entities
    // (e.g. a user broadcast with bold/spoiler/quote) — translating would shift
    // the byte offsets and corrupt the formatting.
    if (lang && typeof text === 'string' && !(options && Array.isArray(options.entities) && options.entities.length)) {
        text = await translateUI(text, lang);
        if (options && options.reply_markup) {
            options = { ...options, reply_markup: await translateMarkup(options.reply_markup, lang) };
        }
    }
    // Turn static emojis into animated premium ones (plain-text sends only).
    options = withPremiumText(text, options);
    return _origSendMessage(chatId, text, options);
};

const _origEditMessageText = bot.editMessageText.bind(bot);
bot.editMessageText = async function (text, options) {
    const lang = getUiLang(options && options.chat_id);
    if (lang && typeof text === 'string' && !(options && Array.isArray(options.entities) && options.entities.length)) {
        text = await translateUI(text, lang);
        if (options && options.reply_markup) {
            options = { ...options, reply_markup: await translateMarkup(options.reply_markup, lang) };
        }
    }
    options = withPremiumText(text, options);
    return _origEditMessageText(text, options);
};

const _origEditMessageCaption = bot.editMessageCaption.bind(bot);
bot.editMessageCaption = async function (caption, options) {
    const lang = getUiLang(options && options.chat_id);
    if (lang && typeof caption === 'string' && !(options && Array.isArray(options.caption_entities) && options.caption_entities.length)) {
        caption = await translateUI(caption, lang);
        if (options && options.reply_markup) {
            options = { ...options, reply_markup: await translateMarkup(options.reply_markup, lang) };
        }
    }
    options = withPremiumCaption(caption, options);
    return _origEditMessageCaption(caption, options);
};

// Media senders carry their text in options.caption.
['sendPhoto', 'sendVideo', 'sendAnimation', 'sendDocument', 'sendAudio'].forEach((method) => {
    const orig = bot[method].bind(bot);
    bot[method] = async function (chatId, media, options) {
        const lang = getUiLang(chatId);
        if (lang && options) {
            options = { ...options };
            // Skip caption translation when caption_entities are supplied
            // (offsets would misalign — same reasoning as sendMessage).
            if (typeof options.caption === 'string' && !options.caption_entities) {
                options.caption = await translateUI(options.caption, lang);
            }
            if (options.reply_markup) {
                options.reply_markup = await translateMarkup(options.reply_markup, lang);
            }
        }
        if (options && typeof options.caption === 'string') {
            options = withPremiumCaption(options.caption, options);
        }
        return orig(chatId, media, options);
    };
});

// Inline keyboard shown by /language.
function buildLanguageKeyboard(current) {
    const rows = [];
    rows.push([{
        text: (!current || current === 'en' ? '✓ ' : '') + 'English (default)',
        callback_data: 'lang_set_en'
    }]);
    let row = [];
    for (const [code, name] of Object.entries(LANG_NAMES)) {
        if (code === 'en') continue;
        row.push({ text: (current === code ? '✓ ' : '') + name, callback_data: 'lang_set_' + code });
        if (row.length === 2) { rows.push(row); row = []; }
    }
    if (row.length) rows.push(row);
    return { inline_keyboard: rows };
}

// ─── /premiumemojis (owner) ───
// The bot only animates emojis it has "learned" — i.e. custom (premium) emoji
// the owner has sent it. This command lets the owner register them in bulk
// (reply to / send a message full of premium emojis) and review what's stored.
onCmd(/^\/premiumemojis(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!BOT_OWNER_IDS.includes(Number(userId))) {
        return bot.sendMessage(chatId, `This command is owner-only.`);
    }
    // If replying to a message with premium emojis, collect them now.
    if (msg.reply_to_message) {
        collectPremiumEmoji(msg.reply_to_message);
    }
    const keys = Object.keys(PREMIUM_EMOJIS);
    const list = keys.length ? keys.join(' ') : '(none yet)';
    await bot.sendMessage(chatId,
        `Premium (animated) emojis: ${keys.length}\n\n${list}\n\nTo add more: send me a message containing premium emojis (or reply to one with /premiumemojis). Every static copy of these emojis in my messages will then animate automatically.`
    );
});

async function showLanguageMenu(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type !== 'private' && !(await isAdmin(chatId, userId))) {
        const sent = await bot.sendMessage(chatId, `Only admins can change the bot language.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const current = getGroup(chatId).uiLang || 'en';
    const curName = LANG_NAMES[current] || 'English';
    await bot.sendMessage(chatId,
        `🌐 Bot Language\n\nCurrent language: ${curName}\n\nPick a language below. Everything the bot says — menus, buttons, warnings and replies — will switch to it.`,
        { reply_markup: buildLanguageKeyboard(current) }
    );
}

// ─── /language ───
onCmd(/^\/lang(?:uage)?(?:@\w+)?$/, showLanguageMenu);

onCmd(/^\/trd(?:@\w+)?(?:\s+(\S+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const arg = match[1] ? match[1].toLowerCase().trim() : null;
    if (msg.chat.type !== 'private' && arg) {
        if (!(await isAdmin(chatId, userId))) {
            const sent = await bot.sendMessage(chatId, `Only admins can change auto-translate settings.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
    }
    if (!arg) {
        const current = getGroup(chatId).translateTo || chatTranslate[chatId] || null;
        const sent = await bot.sendMessage(chatId,
            `Auto-Translate\n\n  Current: ${current ? `${LANG_NAMES[current] || current} (${current})` : 'OFF'}\n\n  Usage:\n  /trd en — translate all to English\n  /trd fr — translate all to French\n  /trd off — disable\n\n  Common codes: en fr es de it pt ru zh ja ko ar hi`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return;
    }
    if (arg === 'off') {
        const group = getGroup(chatId);
        group.translateTo = null;
        delete chatTranslate[chatId];
        saveDB();
        const sent = await bot.sendMessage(chatId, `Auto-translate disabled.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const group = getGroup(chatId);
    group.translateTo = arg;
    chatTranslate[chatId] = arg;
    saveDB();
    const langName = LANG_NAMES[arg] || arg.toUpperCase();
    const sent = await bot.sendMessage(chatId, `Auto-translate enabled → ${langName} (${arg})\n\n  All messages will now be translated automatically.`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 10000);
});

// ─── /short ───
onCmd(/^\/short(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1] ? match[1].trim() : null;
    if (!input) {
        const sent = await bot.sendMessage(chatId,
            `Short Link\n\n  /short <url>\n  /short <url> | custom-slug\n  /short <url> | slug | password\n  /short <url> | slug | password | 24h\n\n  Examples:\n  /short https://ai.crysnovax.link\n  /short https://link.com | mylink\n  /short https://link.com | secret | pass123 | 48`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return;
    }
    const parts = input.split('|').map(p => p.trim());
    const longUrl = parts[0];
    const customSlug = parts[1] || undefined;
    const password = parts[2] || undefined;
    const expiresIn = parts[3] ? parseInt(parts[3]) : undefined;
    if (!/^https?:\/\//i.test(longUrl)) {
        const sent = await bot.sendMessage(chatId, `URL must start with http:// or https://`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const waitMsg = await bot.sendMessage(chatId, `Shortening...`);
    try {
        const body = JSON.stringify({
            url: longUrl,
            slug: customSlug,
            password: password,
            expiresIn: expiresIn
        });
        const data = await new Promise((resolve, reject) => {
            const req = require('https').request({
                hostname: 'sl.crysnovax.link',
                path: '/api/shorten',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            }, res => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        if (!data.status) {
            const sent = await bot.sendMessage(chatId, `${data.error || 'Shortening failed'}`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        let caption = `Link Shortened!\n\n  Short: ${data.shortUrl}\n  Slug: ${data.slug}\n${password ? `  ☕︎ Protected: Yes\n` : ''}${data.expiresAt ? `  ☻ Expires: ${new Date(data.expiresAt).toLocaleString()}\n` : ''}\n  sl.crysnovax.link`;
        await bot.sendPhoto(chatId, data.qrUrl, {
            caption,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '☕︎ Open Short Link', url: data.shortUrl }
                ]]
            }
        });
    } catch (e) {
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const sent = await bot.sendMessage(chatId, `Shortening failed: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /shortinfo ───
onCmd(/^\/shortinfo(?:@\w+)?(?:\s+(\S+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const slug = match[1] ? match[1].trim().replace('https://sl.crysnovax.link/', '').replace(/\//g, '') : null;
    if (!slug) {
        const sent = await bot.sendMessage(chatId, `Usage: /shortinfo <slug or short URL>`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const waitMsg = await bot.sendMessage(chatId, `Fetching link info...`);
    try {
        const data = await new Promise((resolve, reject) => {
            require('https').get(`https://sl.crysnovax.link/api/info/${slug}`, res => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
                res.on('error', reject);
            });
        });
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        if (!data.status) {
            const sent = await bot.sendMessage(chatId, `${data.error || 'Not found'}`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        let caption = `Link Info\n\n  Short: ${data.shortUrl}\n  Slug: ${data.slug}\n  Original: ${data.originalUrl.slice(0, 60)}...\n  Clicks: ${data.clicks}\n  Created: ${new Date(data.created).toLocaleString()}\n${data.hasPassword ? `  🔒 Protected: Yes\n` : ''}${data.expiresAt ? `  ⏰ Expires: ${new Date(data.expiresAt).toLocaleString()}\n` : ''}\n  sl.crysnovax.link`;
        const sent = await bot.sendPhoto(chatId, data.qrUrl, {
            caption,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '☕︎ Open Short Link', url: data.shortUrl }
                ]]
            }
        });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 60000);
    } catch (e) {
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const sent = await bot.sendMessage(chatId, `Failed: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /shortdelete ───
onCmd(/^\/shortdelete(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1] ? match[1].trim() : null;
    if (!input) {
        const sent = await bot.sendMessage(chatId, `Usage: /shortdelete <slug> | <password (if protected)>`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const parts = input.split('|').map(p => p.trim());
    const slug = parts[0].replace('https://sl.crysnovax.link/', '').replace(/\//g, '');
    const password = parts[1] || '';
    const waitMsg = await bot.sendMessage(chatId, `Deleting...`);
    try {
        const body = JSON.stringify({ password: password || undefined });
        const data = await new Promise((resolve, reject) => {
            const req = require('https').request({
                hostname: 'sl.crysnovax.link',
                path: `/api/delete/${slug}`,
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            }, res => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        if (data.status) {
            const sent = await bot.sendMessage(chatId, `Link deleted successfully.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
        } else {
            const sent = await bot.sendMessage(chatId, `${data.error || 'Delete failed'}`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
        }
    } catch (e) {
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const sent = await bot.sendMessage(chatId, `Delete failed: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /play ───
let yts, playAxios;
try {
    yts = require('yt-search');
    playAxios = require('axios');
} catch (e) {
    console.warn('/play: yt-search or axios not installed. Run: npm install yt-search axios');
}
const playCrypto = require('crypto');

function extractYouTubeId(input) {
    if (!input) return null;
    const patterns = [
        /youtube\.com\/watch\?v=([\w-]{11})/,
        /youtube\.com\/shorts\/([\w-]{11})/,
        /youtube\.com\/embed\/([\w-]{11})/,
        /youtu\.be\/([\w-]{11})/
    ];
    for (const p of patterns) {
        const m = input.match(p);
        if (m) return m[1];
    }
    return /^[\w-]{11}$/.test(input) ? input : null;
}

function decryptSaveTubePayload(enc) {
    const secretKey = 'C5D58EF67A7584E4A29F6C35BBC4EB12';
    const raw = Buffer.from(enc, 'base64');
    const iv = raw.subarray(0, 16);
    const body = raw.subarray(16);
    const key = Buffer.from(secretKey.match(/.{1,2}/g).join(''), 'hex');
    const decipher = playCrypto.createDecipheriv('aes-128-cbc', key, iv);
    return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'));
}

async function playFetch(url, opts = {}) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return opts.raw ? res : res.json();
}

async function getYTAudio(videoId) {
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const failures = [];
    try {
        const cdnInfo = await playFetch('https://media.savetube.vip/api/random-cdn');
        const cdnHost = cdnInfo.cdn;
        if (!cdnHost) throw new Error('Missing CDN host');
        const headers = { origin: 'https://mp3juice3.ninja', referer: 'https://mp3juice3.ninja/' };
        const info = await playFetch(`https://${cdnHost}/v2/info`, {
            method: 'POST',
            headers: { accept: '*/*', 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0', ...headers },
            body: JSON.stringify({ url: canonicalUrl })
        });
        const meta = decryptSaveTubePayload(info.data);
        const dl = await playFetch(`https://${cdnHost}/download`, {
            method: 'POST',
            headers: { accept: '*/*', 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0', ...headers },
            body: JSON.stringify({ downloadType: 'audio', quality: 128, key: meta.key })
        });
        const direct = dl?.data?.downloadUrl;
        if (!direct) throw new Error('Missing download URL');
        const audioRes = await fetch(direct);
        return { buffer: Buffer.from(await audioRes.arrayBuffer()), title: meta.title, thumbnail: meta.thumbnail, provider: 'savetube' };
    } catch (e) { failures.push(`savetube: ${e.message}`); }
    try {
        const cnvH = { Accept: 'application/json', 'Content-Type': 'application/json', Origin: 'https://cnvmp3.com', Referer: 'https://cnvmp3.com/v54', 'User-Agent': 'Mozilla/5.0' };
        const meta = await (await fetch('https://cnvmp3.com/get_video_data.php', { method: 'POST', headers: cnvH, body: JSON.stringify({ url: canonicalUrl, token: '1234' }) })).json();
        if (!meta.success || !meta.title) throw new Error(meta.error || 'missing title');
        const dl = await (await fetch('https://cnvmp3.com/download_video_ucep.php', { method: 'POST', headers: cnvH, body: JSON.stringify({ url: canonicalUrl, quality: 4, title: meta.title, formatValue: 1 }) })).json();
        if (!dl.success || !dl.download_link) throw new Error(dl.error || 'missing link');
        const audioRes = await fetch(dl.download_link);
        return { buffer: Buffer.from(await audioRes.arrayBuffer()), title: meta.title, provider: 'cnvmp3' };
    } catch (e) { failures.push(`cnvmp3: ${e.message}`); }
    try {
        const apiKey = 'dfcb6d76f2f6a9894gjkege8a4ab232222';
        const startRes = await (await fetch(`https://p.savenow.to/ajax/download.php?copyright=0&format=mp3&url=${encodeURIComponent(canonicalUrl)}&api=${apiKey}`, { headers: { accept: '*/*', referer: 'https://ytmp3.so/', 'user-agent': 'Mozilla/5.0' } })).json();
        if (!startRes.success) throw new Error('init unsuccessful');
        const directUrl = startRes.downloadUrl || startRes.download_url;
        if (directUrl) {
            const audioRes = await fetch(directUrl);
            return { buffer: Buffer.from(await audioRes.arrayBuffer()), title: startRes.title, provider: 'savenow' };
        }
        if (!startRes.id) throw new Error('missing id');
        for (let i = 0; i < 20; i++) {
            const poll = await (await fetch(`https://p.savenow.to/ajax/progress.php?id=${encodeURIComponent(startRes.id)}`, { headers: { accept: '*/*', referer: 'https://ytmp3.so/', 'user-agent': 'Mozilla/5.0' } })).json();
            const u = poll.downloadUrl || poll.download_url || poll.url;
            if (u) {
                const audioRes = await fetch(u);
                return { buffer: Buffer.from(await audioRes.arrayBuffer()), title: startRes.title, provider: 'savenow' };
            }
            await new Promise(r => setTimeout(r, 2000));
        }
        throw new Error('timed out');
    } catch (e) { failures.push(`savenow: ${e.message}`); }
    const RAPID_KEYS = [
        '26326ad4e2msha67982d35518d98p1f16aejsn2758906787c6',
        'f33faab7b9msh7debbd81b2366c6p10e535jsn94995ebe4cbe',
        'bebbe34903msh5b866dbc4eeee83p1015f4jsnfa9f6d69aca9'
    ];
    for (let k = 0; k < RAPID_KEYS.length; k++) {
        try {
            if (!playAxios) throw new Error('axios not installed');
            const res = await playAxios.get('https://youtube-mp36.p.rapidapi.com/dl', {
                params: { id: videoId },
                headers: { 'x-rapidapi-key': RAPID_KEYS[k], 'x-rapidapi-host': 'youtube-mp36.p.rapidapi.com' },
                timeout: 30000
            });
            if (res.data?.status === 'processing') {
                await new Promise(r => setTimeout(r, 3000));
                k--; continue;
            }
            if (res.data?.status !== 'ok' || !res.data?.link) throw new Error('no link');
            const audioRes = await playAxios.get(res.data.link, { responseType: 'arraybuffer', timeout: 60000 });
            return { buffer: Buffer.from(audioRes.data), title: res.data.title, provider: `rapidapi-key${k + 1}` };
        } catch (e) { failures.push(`rapidapi-${k}: ${e.message}`); }
    }
    throw new Error(`All providers failed:\n${failures.join('\n')}`);
}

onCmd(/^\/play(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1] ? match[1].trim() : null;
    if (!query) {
        const sent = await bot.sendMessage(chatId, `Usage: /play <song title or YouTube URL>\nExample: /play Assurance by Davido`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return;
    }
    if (!yts) {
        const sent = await bot.sendMessage(chatId, `/play requires yt-search and axios. Run: npm install yt-search axios`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const waitMsg = await bot.sendMessage(chatId, `Searching...`);
    try {
        const isUrl = extractYouTubeId(query) !== null;
        let videoId, videoTitle, videoAuthor, videoDuration;
        if (isUrl) {
            videoId = extractYouTubeId(query);
            try {
                const r = await yts({ videoId });
                videoTitle = r.title || 'Unknown';
                videoAuthor = r.author?.name || 'Unknown';
                videoDuration = r.timestamp || 'Unknown';
            } catch (e) {
                videoTitle = 'YouTube Audio';
                videoAuthor = 'Unknown';
                videoDuration = 'Unknown';
            }
        } else {
            const results = await yts(query);
            if (!results.videos.length) {
                await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
                const sent = await bot.sendMessage(chatId, `No results found.`);
                setTimeout(() => {
                    bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                }, 5000);
                return;
            }
            const v = results.videos[0];
            videoId = v.videoId;
            videoTitle = v.title;
            videoAuthor = v.author.name;
            videoDuration = v.timestamp;
        }
        await bot.editMessageText(`Found: ${videoTitle.substring(0, 50)}\nDownloading audio...`, {
            chat_id: chatId,
            message_id: waitMsg.message_id,
            parse_mode: 'Markdown'
        }).catch(() => {});
        const audioData = await getYTAudio(videoId);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const youtubeLink = `https://youtu.be/${videoId}`;
        await bot.sendMessage(chatId, youtubeLink);
        const audioOptions = {
            title: audioData.title || videoTitle,
            performer: videoAuthor
        };
        await bot.sendAudio(chatId, audioData.buffer, audioOptions, {
            filename: `${(audioData.title || videoTitle).substring(0, 60)}.mp3`,
            contentType: 'audio/mpeg'
        });
    } catch (e) {
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        console.error('/play error:', e.message);
        const sent = await bot.sendMessage(chatId, `Download failed: ${e.message.substring(0, 200)}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /listmembers ───
onCmd(/\/listmembers/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') return bot.sendMessage(chatId, `This command only works in groups.`);
    if (!(await isAdmin(chatId, userId))) return bot.sendMessage(chatId, `Only admins can use this command.`);
    try {
        const admins = await bot.getChatAdministrators(chatId);
        const group = getGroup(chatId);
        let text = `Members Overview\n\n  Admins (${admins.length}):\n`;
        admins.forEach(a => {
            const u = a.user;
            const name = getUserLink(u);
            text += `    ${name} — ${a.status}\n`;
        });
        const adminIds = new Set(admins.map(a => String(a.user.id)));
        const others = Object.entries(group.knownMembers)
            .filter(([id]) => !adminIds.has(id));
        text += `\n  Other known members (${others.length}):\n`;
        if (others.length === 0) {
            text += `    None tracked yet.`;
        } else {
            others.slice(0, 50).forEach(([id, info]) => {
                const userObj = { id: Number(id), first_name: info.name, username: info.username };
                text += `    ${getUserLink(userObj)}\n`;
            });
            if (others.length > 50) text += `\n    ...and ${others.length - 50} more`;
        }
        text += `\n\n  Note: Telegram doesn't allow bots to fetch a full member list.\n  This shows admins and members the bot has observed.`;
        const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 60000);
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to fetch members: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /setlog ───
onCmd(/\/setlog/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!(await isAdmin(chatId, userId))) {
        const sent = await bot.sendMessage(chatId, `Only admins can use this command.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `Run /setlog inside the group you want logs for.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const group = getGroup(chatId);
    group.logChatId = chatId;
    saveDB();
    const sent = await bot.sendMessage(chatId, `This chat is now set as its own log destination.`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /setlogto ───
onCmd(/\/setlogto (-?\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `This command only works in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (!(await isAdmin(chatId, userId))) {
        const sent = await bot.sendMessage(chatId, `Only admins can use this command.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const targetId = match[1];
    const group = getGroup(chatId);
    group.logChatId = targetId;
    saveDB();
    const sent = await bot.sendMessage(chatId, `Log channel set to chat ID ${targetId}.\n\n  Make sure the bot is a member/admin of that chat.`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 10000);
});

// ─── /unsetlog ───
onCmd(/\/unsetlog/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `This command only works in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (!(await isAdmin(chatId, userId))) {
        const sent = await bot.sendMessage(chatId, `Only admins can use this command.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const group = getGroup(chatId);
    group.logChatId = null;
    saveDB();
    const sent = await bot.sendMessage(chatId, `Log channel removed.`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /chatid ───
onCmd(/\/chatid/, (msg) => {
    const sent = bot.sendMessage(msg.chat.id, `This chat's ID is: ${msg.chat.id}`);
    setTimeout(() => {
        bot.deleteMessage(msg.chat.id, sent.message_id).catch(() => {});
        bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /broadcast ───
const BROADCAST_ALLOWED_CHATS = [7770578824];
onCmd(/^\/broadcast(?:@\w+)?(?:\s|$)/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const isOwner = BOT_OWNER_IDS.includes(userId);
    const isAllowedChat = BROADCAST_ALLOWED_CHATS.includes(chatId);
    if (!isOwner && !isAllowedChat) {
        const sent = await bot.sendMessage(chatId, `Owner only.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    
    pendingBroadcastSetup[chatId] = {
        step: 'pp_choice',
        userId: userId,
        ppEnabled: false,
        hasButton: false,
        buttons: [],
        buttonCount: 0,
        currentButton: 0,
        message: null,
        media: null,
        target: 'Both'
    };
    
    const keyboard = {
        keyboard: [
            ['With PP', 'Without PP'],
            ['Cancel']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    };
    
    await bot.sendMessage(chatId, 
        `˗ˏˋ☏ˎ��˗︎ Broadcast Setup\n\nChoose profile picture option:`,
        { reply_markup: keyboard }
    );
    setTimeout(() => {
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 1000);
});

// ─── /users ───
async function showUsersList(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const isOwner = BOT_OWNER_IDS.includes(userId);
    if (!isOwner) {
        const sent = await bot.sendMessage(chatId, `Owner only.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const groupIds = Object.keys(db).filter(id => id !== '__dmUsers' && Number(id) < 0);
    const dmIds = Array.from(dmUsers);
    let groupLines = [];
    for (const id of groupIds) {
        try {
            const chat = await bot.getChat(id);
            const memberCount = await bot.getChatMemberCount(id);
            let link = chat.invite_link || null;
            if (!link) {
                try {
                    const inv = await bot.exportChatInviteLink(id);
                    link = inv;
                } catch (e) { link = null; }
            }
            const linkPart = link ? ` · [Link](${link})` : '';
            const knownMembers = Object.entries(getGroup(id).knownMembers || {});
            groupLines.push(`  ${chat.title || 'Unknown'} · ${id} �� ${memberCount} members · ${knownMembers.length} observed${linkPart}`);
            for (const [memberId, member] of knownMembers) {
                const username = member.username ? ` @${member.username}` : '';
                groupLines.push(`    ↳ ${member.name || 'Unknown'}${username} · ${memberId}`);
            }
        } catch (e) {
            groupLines.push(`  (inaccessible) · ${id}`);
        }
    }
    let dmLines = [];
    for (const id of dmIds) {
        try {
            const chat = await bot.getChat(id);
            const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || 'Unknown';
            const username = chat.username ? ` @${chat.username}` : '';
            dmLines.push(`  [${name}](tg://user?id=${id})${username} · ${id}`);
        } catch (e) {
            dmLines.push(`  (unknown) · ${id}`);
        }
    }
    const header = `Bot Users Overview\n\n  DM Users: ${dmIds.length}\n  Groups: ${groupIds.length}\n  Total: ${groupIds.length + dmIds.length}\n`;
    const chunks = [];
    let current = header;
    if (dmLines.length) {
        current += `\n  Users (${dmLines.length}):\n`;
        for (const line of dmLines) {
            if ((current + line + '\n').length > 3800) {
                chunks.push(current);
                current = '';
            }
            current += line + '\n';
        }
    }
    if (groupLines.length) {
        current += `\n  Groups (${groupLines.length}):\n`;
        for (const line of groupLines) {
            if ((current + line + '\n').length > 3800) {
                chunks.push(current);
                current = '';
            }
            current += line + '\n';
        }
    }
    if (current.trim()) chunks.push(current);
    for (const chunk of chunks) {
        const sent = await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' }).catch(() => {});
        if (sent) {
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            }, 60000);
        }
    }
    setTimeout(() => {
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 1000);
}
onCmd(/^\/users(?:@\w+)?(?:\s|$)/, showUsersList);

// ─── /poststory ───
onCmd(/^\/poststory(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `This command only works in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (!(await isAdmin(chatId, userId))) {
        const sent = await bot.sendMessage(chatId, `Only admins can use this command.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const replyMsg = msg.reply_to_message;
    if (!replyMsg || !(replyMsg.photo || replyMsg.video || replyMsg.animation)) {
        const sent = await bot.sendMessage(chatId,
            `Reply to a photo, video, or GIF with /poststory <caption>\n\n  Note: bots can't post to Telegram "Stories" — this posts a styled, pinned announcement instead.`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return;
    }
    const caption = match[1] ? match[1].trim() : '';
    const header = `STORY UPDATE\n\n`;
    const footer = `\n\n  Posted by ${msg.from.first_name || 'an admin'}`;
    const fullCaption = `${header}${caption}${footer}`;
    try {
        let sent;
        if (replyMsg.photo) {
            sent = await bot.sendPhoto(chatId, replyMsg.photo[replyMsg.photo.length - 1].file_id, { caption: fullCaption, parse_mode: 'Markdown' });
        } else if (replyMsg.video) {
            sent = await bot.sendVideo(chatId, replyMsg.video.file_id, { caption: fullCaption, parse_mode: 'Markdown' });
        } else {
            sent = await bot.sendAnimation(chatId, replyMsg.animation.file_id, { caption: fullCaption, parse_mode: 'Markdown' });
        }
        await bot.pinChatMessage(chatId, sent.message_id, { disable_notification: true }).catch(() => {});
        await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        }, 300000);
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to post: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /report ───
onCmd(/^\/report(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `This command only works in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (!msg.reply_to_message) {
        const sent = await bot.sendMessage(chatId, `Reply to the message you want to report with /report [reason].`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const reason = match[1] ? match[1].trim() : 'No reason given';
    const reported = msg.reply_to_message;
    let admins;
    try {
        admins = await bot.getChatAdministrators(chatId);
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Could not fetch the admin list.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const groupName = msg.chat.title || 'this group';
    const text = `New Report\n\n  Group: ${groupName}\n  Reported: ${getUserLink(reported.from)}\n  Reporter: ${getUserLink(msg.from)}\n  Reason: ${reason}\n\n  The reported message is forwarded below.`;
    let notified = 0;
    for (const admin of admins) {
        if (admin.user.is_bot) continue;
        try {
            await bot.sendMessage(admin.user.id, text, { parse_mode: 'Markdown' });
            await bot.forwardMessage(admin.user.id, chatId, reported.message_id);
            notified++;
        } catch (e) {}
    }
    try { await bot.deleteMessage(chatId, msg.message_id); } catch (e) {}
    if (notified > 0) {
        const sent = await bot.sendMessage(chatId, `${getUserLink(msg.from)}, your report was sent to ${notified} admin(s) privately.`, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
    } else {
        const sent = await bot.sendMessage(chatId, `Couldn't reach any admins — make sure they've started a DM with the bot.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
    }
});

// ─── /poll ───
onCmd(/^\/poll(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `This command only works in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (!(await isAdmin(chatId, userId))) {
        const sent = await bot.sendMessage(chatId, `Only admins can use this command.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const input = match[1];
    if (!input) {
        const sent = await bot.sendMessage(chatId, `Usage: /poll <question> | <option1> | <option2> | ...\n  Example: /poll Best language? | JS | Python | Go`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return;
    }
    const parts = input.split('|').map(p => p.trim()).filter(Boolean);
    if (parts.length < 3) {
        const sent = await bot.sendMessage(chatId, `Provide a question and at least 2 options, separated by |.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const question = parts[0];
    const options = parts.slice(1, 11);
    try {
        await bot.sendPoll(chatId, question, options, { is_anonymous: true });
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to create poll: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /note ───
onCmd(/^\/note(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `This command only works in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (!(await isAdmin(chatId, userId))) {
        const sent = await bot.sendMessage(chatId, `Only admins can use this command.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const group = getGroup(chatId);
    const replyMsg = msg.reply_to_message;
    let name;
    if (replyMsg) {
        name = match[1] ? match[1].trim().toLowerCase().split(/\s+/)[0] : null;
        if (!name) {
            const sent = await bot.sendMessage(chatId, `Reply to a message with /note <name>`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        if (replyMsg.photo) {
            group.notes[name] = { type: 'photo', fileId: replyMsg.photo[replyMsg.photo.length - 1].file_id, caption: replyMsg.caption || '' };
        } else if (replyMsg.video) {
            group.notes[name] = { type: 'video', fileId: replyMsg.video.file_id, caption: replyMsg.caption || '' };
        } else if (replyMsg.document) {
            group.notes[name] = { type: 'document', fileId: replyMsg.document.file_id, caption: replyMsg.caption || '' };
        } else if (replyMsg.animation) {
            group.notes[name] = { type: 'animation', fileId: replyMsg.animation.file_id, caption: replyMsg.caption || '' };
        } else if (replyMsg.sticker) {
            group.notes[name] = { type: 'sticker', fileId: replyMsg.sticker.file_id, caption: '' };
        } else if (replyMsg.voice) {
            group.notes[name] = { type: 'voice', fileId: replyMsg.voice.file_id, caption: replyMsg.caption || '' };
        } else if (replyMsg.audio) {
            group.notes[name] = { type: 'audio', fileId: replyMsg.audio.file_id, caption: replyMsg.caption || '' };
        } else if (replyMsg.text) {
            group.notes[name] = { type: 'text', text: replyMsg.text };
        } else {
            const sent = await bot.sendMessage(chatId, `Unsupported message type for a note.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
    } else {
        const input = match[1];
        if (!input || !input.includes('|')) {
            const sent = await bot.sendMessage(chatId, `Usage: /note <name> | <text>\n  Or reply to a text/media message with /note <name>`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 10000);
            return;
        }
        const sep = input.indexOf('|');
        name = input.slice(0, sep).trim().toLowerCase();
        const content = input.slice(sep + 1).trim();
        if (!name || !content) {
            const sent = await bot.sendMessage(chatId, `Both name and content must be non-empty.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        group.notes[name] = { type: 'text', text: content };
    }
    saveDB();
    const sent = await bot.sendMessage(chatId, `Note saved. Retrieve it anytime with #${name}`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /notes ───
onCmd(/^\/notes(?:@\w+)?(?:\s|$)/, async (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `This command only works in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const group = getGroup(chatId);
    const names = Object.keys(group.notes);
    if (names.length === 0) {
        const sent = await bot.sendMessage(chatId, `No notes saved yet. Add one with /note <name> | <text>`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    let text = `Saved Notes (${names.length}):\n\n`;
    names.forEach(n => { text += `  #${n}\n`; });
    const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 30000);
});

// ─── /clearnotes ───
onCmd(/^\/clearnotes(?:@\w+)?(?:\s|$)/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `This command only works in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (!(await isAdmin(chatId, userId))) {
        const sent = await bot.sendMessage(chatId, `Only admins can use this command.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const group = getGroup(chatId);
    const count = Object.keys(group.notes).length;
    group.notes = {};
    saveDB();
    const sent = await bot.sendMessage(chatId, `Cleared ${count} note(s).`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /weather ───
onCmd(/^\/weather(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const city = match[1] ? match[1].trim() : null;
    if (!city) {
        const sent = await bot.sendMessage(chatId, `Usage: /weather <city>\n  Example: /weather Lagos`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    try {
        const axios = require('axios');
        const res = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { timeout: 10000 });
        const cur = res.data.current_condition[0];
        const area = res.data.nearest_area[0];
        const locationName = `${area.areaName[0].value}, ${area.country[0].value}`;
        const text = `Weather — ${locationName}\n\n  Condition: ${cur.weatherDesc[0].value}\n  Temp: ${cur.temp_C}°C (feels ${cur.FeelsLikeC}°C)\n  Humidity: ${cur.humidity}%\n  Wind: ${cur.windspeedKmph} km/h\n  Visibility: ${cur.visibility} km\n  UV Index: ${cur.uvIndex}`;
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Couldn't fetch weather for "${city}". Try a different city name.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /qr ───
onCmd(/^\/qr(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const text = match[1] ? match[1].trim() : null;
    if (!text) {
        const sent = await bot.sendMessage(chatId, `Usage: /qr <text or url>\n  Example: /qr https://t.me/crysnovax`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(text)}`;
    try {
        await bot.sendPhoto(chatId, url, { caption: `QR code for:\n  ${text}`, parse_mode: 'Markdown' });
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to generate QR code.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /qrread ───
onCmd(/^\/qrread(?:@\w+)?(?:\s|$)/, async (msg) => {
    const chatId = msg.chat.id;
    const photoMsg = msg.reply_to_message || msg;
    const photo = photoMsg.photo ||
        (photoMsg.document && photoMsg.document.mime_type && photoMsg.document.mime_type.startsWith('image/')
            ? [{ file_id: photoMsg.document.file_id }]
            : null);
    if (!photo) {
        const sent = await bot.sendMessage(chatId,
            `QR Code Reader\n\n  Reply to a photo containing a QR code with /qrread.`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const waitMsg = await bot.sendMessage(chatId, `Reading QR code...`);
    try {
        const fileId = photo[photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(fileId);
        const imgBuffer = await new Promise((resolve, reject) => {
            require('https').get(fileLink, (res) => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => resolve(Buffer.concat(chunks)));
                res.on('error', reject);
            }).on('error', reject);
        });
        const boundary = `----TGBotBoundary${Date.now()}`;
        const CRLF = '\r\n';
        const bodyParts = [
            `--${boundary}${CRLF}`,
            `Content-Disposition: form-data; name="file"; filename="qr.jpg"${CRLF}`,
            `Content-Type: image/jpeg${CRLF}`,
            CRLF
        ].join('');
        const bodyEnd = `${CRLF}--${boundary}--${CRLF}`;
        const bodyBuffer = Buffer.concat([
            Buffer.from(bodyParts),
            imgBuffer,
            Buffer.from(bodyEnd)
        ]);
        const data = await new Promise((resolve, reject) => {
            const req = require('https').request({
                hostname: 'api.qrserver.com',
                path: '/v1/read-qr-code/',
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': bodyBuffer.length
                }
            }, (res) => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', () => {
                    try { resolve(JSON.parse(d)); }
                    catch (e) { reject(new Error(`Bad API response: ${d.slice(0, 100)}`)); }
                });
                res.on('error', reject);
            });
            req.on('error', reject);
            req.write(bodyBuffer);
            req.end();
        });
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const symbol = data?.[0]?.symbol?.[0];
        if (!symbol || symbol.error || !symbol.data) {
            const sent = await bot.sendMessage(chatId, `Could not decode QR code. Make sure the image is clear and contains a valid QR code.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        const decoded = symbol.data;
        const isUrl = /^https?:\/\//i.test(decoded) || /^www\./i.test(decoded);
        const replyOpts = {
            parse_mode: 'Markdown',
            reply_to_message_id: photoMsg.message_id
        };
        if (isUrl) {
            replyOpts.reply_markup = {
                inline_keyboard: [[
                    { text: '☕︎ Open Link', url: decoded.startsWith('http') ? decoded : 'https://' + decoded }
                ]]
            };
        }
        const sent = await bot.sendMessage(chatId, `QR Code Decoded\n\n  ${decoded}`, replyOpts);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 60000);
    } catch (e) {
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const sent = await bot.sendMessage(chatId, `QR read failed: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /schedule ───
onCmd(/^\/schedule(?:@\w+)?(?:\s+(\S+)\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `This command only works in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (!(await isAdmin(chatId, userId))) {
        const sent = await bot.sendMessage(chatId, `Only admins can use this command.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (!match[1] || !match[2]) {
        const sent = await bot.sendMessage(chatId, `Usage: /schedule <duration> <message>\n  Example: /schedule 30m Don't forget the meeting tonight!\n  Duration formats: 30s, 10m, 2h, 1d`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return;
    }
    const ms = parseDuration(match[1]);
    if (!ms) {
        const sent = await bot.sendMessage(chatId, `Invalid duration. Use formats like 30s, 10m, 2h, 1d.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const text = match[2].trim();
    const sent = await bot.sendMessage(chatId, `Message scheduled to post in ${match[1]}.`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
    setTimeout(async () => {
        try {
            const scheduled = await bot.sendMessage(chatId, `Scheduled Message\n\n${text}`, { parse_mode: 'Markdown' });
            setTimeout(() => {
                bot.deleteMessage(chatId, scheduled.message_id).catch(() => {});
            }, 60000);
        } catch (e) {
            console.error('Scheduled message failed:', e.message);
        }
    }, ms);
});

// ─── /stats ───
onCmd(/^\/stats(?:@\w+)?(?:\s|$)/, async (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `This command only works in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const group = getGroup(chatId);
    const stats = group.stats;
    const topMembers = Object.entries(stats.members)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, count]) => {
            const known = group.knownMembers[id];
            const userObj = known ? { id: Number(id), first_name: known.name, username: known.username } : { id: Number(id), first_name: `User ${id}` };
            return `  ${getUserLink(userObj)} — ${count} msgs`;
        }).join('\n');
    let gameStatus = '';
    if (group.gameState && group.gameState.active) {
        gameStatus = `\n\n  Active Game: ${group.gameState.type}`;
    }
    const text = `Group Stats\n\n  Total messages: ${stats.messages}\n  Members joined: ${stats.joins}\n  Members left: ${stats.leaves}${gameStatus}\n\n  Most Active:\n${topMembers || '  No data yet.'}`;
    const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 60000);
});

// ─── /filter ───
onCmd(/\/filter (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `This command only works in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (!(await isAdmin(chatId, userId))) {
        const sent = await bot.sendMessage(chatId, `Only admins can use this command.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const input = match[1];
    const parts = input.split('|');
    if (parts.length < 2) {
        const sent = await bot.sendMessage(chatId, `Usage: /filter <trigger> | <response>\n  Example: /filter hello | Hi there! 👋`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return;
    }
    const trigger = parts[0].trim().toLowerCase();
    const response = parts.slice(1).join('|').trim();
    if (!trigger || !response) {
        const sent = await bot.sendMessage(chatId, `Both trigger and response must be non-empty.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const group = getGroup(chatId);
    group.filters[trigger] = response;
    saveDB();
    const sent = await bot.sendMessage(chatId, `Filter added.\n  Trigger: ${trigger}\n  Response: ${response}`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 10000);
});

// ─── /delfilter ───
onCmd(/\/delfilter (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `This command only works in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (!(await isAdmin(chatId, userId))) {
        const sent = await bot.sendMessage(chatId, `Only admins can use this command.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const trigger = match[1].trim().toLowerCase();
    const group = getGroup(chatId);
    if (!group.filters[trigger]) {
        const sent = await bot.sendMessage(chatId, `No filter found for ${trigger}.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    delete group.filters[trigger];
    saveDB();
    const sent = await bot.sendMessage(chatId, `Filter ${trigger} removed.`);
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 5000);
});

// ─── /filters ───
onCmd(/\/filters/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `This command only works in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (!(await isAdmin(chatId, userId))) {
        const sent = await bot.sendMessage(chatId, `Only admins can use this command.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const group = getGroup(chatId);
    const triggers = Object.keys(group.filters);
    if (triggers.length === 0) {
        const sent = await bot.sendMessage(chatId, `No filters set yet. Add one with /filter <trigger> | <response>`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    let text = `Active Filters (${triggers.length}):\n\n`;
    triggers.forEach(t => {
        text += `  ${t}\n`;
    });
    const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 30000);
});

// ─── /tod — Truth or Dare ───
onCmd(/\/tod(?:\s+(\w+))?/i, async (msg, match) => {
    const chatId = msg.chat.id;
    if (msg.chat.type === 'private') {
        return bot.sendMessage(chatId, `Truth or Dare only works in groups.`);
    }
    const sub = (match[1] || 'start').toLowerCase();

    if (sub === 'stop') {
        const game = todGames[chatId];
        if (!game) {
            const sent = await bot.sendMessage(chatId, `No Truth or Dare game running.`);
            setTimeout(() => bot.deleteMessage(chatId, sent.message_id).catch(() => {}), 5000);
            return;
        }
        const isHost = msg.from.id === game.hostId;
        const isGroupAdmin = await isAdmin(chatId, msg.from.id);
        if (!isHost && !isGroupAdmin) {
            const sent = await bot.sendMessage(chatId, `Only the host or a group admin can stop the game.`);
            setTimeout(() => bot.deleteMessage(chatId, sent.message_id).catch(() => {}), 5000);
            return;
        }
        await endTODGame(chatId, `Stopped by ${getUserLink(msg.from)}.`);
        return;
    }

    // sub === 'start' (default)
    if (todGames[chatId]) {
        const sent = await bot.sendMessage(chatId, `A Truth or Dare game is already running here.\nUse /tod stop to end it first.`);
        setTimeout(() => bot.deleteMessage(chatId, sent.message_id).catch(() => {}), 5000);
        return;
    }

    const game = {
        phase: 'lobby',
        hostId: msg.from.id,
        players: {},
        playerOrder: [],
        turnIndex: -1,
        turnUserId: null,
        partnerUserId: null,
        type: null,
        prompt: null,
        messageId: null
    };
    todGames[chatId] = game;

    const sent = await bot.sendMessage(chatId, renderTODText(game), {
        parse_mode: 'Markdown',
        reply_markup: buildTODKeyboard(game)
    });
    game.messageId = sent.message_id;
});

// ─── /togif (aka /tojif) ───
// Turns a replied-to video/animation into a Telegram "GIF" (an auto-playing,
// sound-less animation). Telegram has no true looping-GIF format, so the
// standard approach is to send an MP4 via sendAnimation — which Telegram then
// renders as a GIF. We simply download the source file and re-upload it
// through sendAnimation, so NO ffmpeg / native binary is required. (The old
// implementation used ffmpeg-static, which cannot install/run on this host.)
const TOJIF_MAX_SOURCE_BYTES = 20 * 1024 * 1024; // 20MB cap — safe for a webhook host with no confirmed disk/CPU headroom

onCmd(/^\/to(?:jif|gif)(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    const replyMsg = msg.reply_to_message;

    // Accept a replied-to video, an existing animation/GIF, a video note, or a
    // document whose mime-type is a video.
    const video = replyMsg && (
        replyMsg.video ||
        replyMsg.animation ||
        replyMsg.video_note ||
        (replyMsg.document && /^video\//i.test(replyMsg.document.mime_type || '') ? replyMsg.document : null)
    );

    if (!video) {
        const sent = await bot.sendMessage(chatId, `Reply to a video with /togif to convert it to a GIF.`);
        setTimeout(() => bot.deleteMessage(chatId, sent.message_id).catch(() => {}), 8000);
        return;
    }

    if (video.file_size && video.file_size > TOJIF_MAX_SOURCE_BYTES) {
        const sizeMB = (video.file_size / (1024 * 1024)).toFixed(1);
        const sent = await bot.sendMessage(chatId, `That video is ${sizeMB}MB — /togif only handles videos up to ${TOJIF_MAX_SOURCE_BYTES / (1024 * 1024)}MB.`);
        setTimeout(() => bot.deleteMessage(chatId, sent.message_id).catch(() => {}), 8000);
        return;
    }

    const stamp = Date.now();
    const inputPath = path.join(__dirname, `tmp_togif_${stamp}.mp4`);

    let processingMsg;
    try {
        processingMsg = await bot.sendMessage(chatId, `Converting video to GIF...`, { reply_to_message_id: msg.message_id });

        // Download the source file to a temp path.
        const fileLink = await bot.getFileLink(video.file_id);
        await new Promise((resolve, reject) => {
            const file = fs.createWriteStream(inputPath);
            https.get(fileLink, (response) => {
                if (response.statusCode !== 200) { reject(new Error(`Download failed (HTTP ${response.statusCode})`)); return; }
                response.pipe(file);
                file.on('finish', () => file.close(resolve));
                file.on('error', reject);
            }).on('error', reject);
        });

        // Re-upload it through sendAnimation. Telegram renders an uploaded MP4
        // sent this way as a looping, sound-less animation (a GIF) — no
        // server-side transcoding, and therefore no ffmpeg, required.
        await bot.sendAnimation(chatId, fs.createReadStream(inputPath), {
            reply_to_message_id: msg.message_id
        });

        await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});

    } catch (e) {
        const errText = `Failed to convert video: ${e.message}`;
        if (processingMsg) {
            await bot.editMessageText(errText, { chat_id: chatId, message_id: processingMsg.message_id }).catch(() => {
                bot.sendMessage(chatId, errText);
            });
        } else {
            await bot.sendMessage(chatId, errText);
        }
    } finally {
        fs.unlink(inputPath, () => {});
    }
});

// ──��� /sleep ───
onCmd(/^\/sleep(?:@\w+)?(?:\s|$)/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `This command only works in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (!(await isAdmin(chatId, userId))) {
        const sent = await bot.sendMessage(chatId, `Only admins can use this command.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const group = getGroup(chatId);
    if (group.sleeping) {
        const sent = await bot.sendMessage(chatId, `Bot is already sleeping. Use /wake to wake it up.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    group.sleeping = true;
    saveDB();
    const text = `Bot is now SLEEPING\n\n  All commands are ignored\n  Only /wake will work\n  Auto-moderation still active\n\n  Use /wake to resume normal operation.`;
    const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 10000);
    sendLog(chatId, `Bot put to sleep by ${getUserLink(msg.from)}`);
});

// ─── /wake ───
onCmd(/^\/wake(?:@\w+)?(?:\s|$)/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `This command only works in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (!(await isAdmin(chatId, userId))) {
        const sent = await bot.sendMessage(chatId, `Only admins can use this command.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const group = getGroup(chatId);
    if (!group.sleeping) {
        const sent = await bot.sendMessage(chatId, `Bot is already awake.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    group.sleeping = false;
    saveDB();
    const text = `Bot is now AWAKE\n\n  All commands are active\n  Normal operation resumed\n\n  Send /menu to see available commands.`;
    const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 10000);
    sendLog(chatId, `Bot woken up by ${getUserLink(msg.from)}`);
});

// ============================================================
// 📦 NEW COMMANDS - SKETCH, SCAN, UNID, TT, WALLPAPER, MOVIE, LIVEMATCH, TTS, TEMPEMAIL, GITHUB, TGSEARCH, AIEDIT
// ============================================================

// ─── SKETCHER ───
onCmd(/^\/sketch(?:er)?(?:@\w+)?(?:\s|$)/, async (msg) => {
    const chatId = msg.chat.id;
    const replyMsg = msg.reply_to_message;
    
    if (!replyMsg) {
        const sent = await bot.sendMessage(chatId,
            `Reply to an image with /sketch\n\n` +
            `Send an image, then reply with: /sketch\n` +
            `The image will be converted to a pencil sketch.`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    
    if (!replyMsg.photo && !(replyMsg.document && replyMsg.document.mime_type && replyMsg.document.mime_type.startsWith('image/'))) {
        const sent = await bot.sendMessage(chatId,
            `Please reply to an IMAGE\n\n` +
            `Send a photo, then reply to it with /sketch`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    
    const waitMsg = await bot.sendMessage(chatId, `Creating pencil sketch...`);
    
    try {
        const sharp = require('sharp');
        
        let fileId;
        if (replyMsg.photo) {
            fileId = replyMsg.photo[replyMsg.photo.length - 1].file_id;
        } else {
            fileId = replyMsg.document.file_id;
        }
        
        const fileLink = await bot.getFileLink(fileId);
        const response = await fetch(fileLink);
        const buffer = Buffer.from(await response.arrayBuffer());
        
        const metadata = await sharp(buffer).metadata();
        const width = Math.min(metadata.width, 1200);
        const height = Math.round(width * (metadata.height / metadata.width));
        
        const grayscale = await sharp(buffer)
            .resize(width, height, { fit: 'inside' })
            .grayscale()
            .toBuffer();
        
        const inverted = await sharp(grayscale)
            .negate()
            .toBuffer();
        
        const blurred = await sharp(inverted)
            .blur(5)
            .toBuffer();
        
        const sketch = await sharp(grayscale)
            .composite([{
                input: blurred,
                blend: 'colour-dodge'
            }])
            .toBuffer();
        
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        
        await bot.sendPhoto(chatId, sketch, {
            caption: `Pencil Sketch!\n\nConverted from your image`,
            parse_mode: 'Markdown',
            reply_to_message_id: msg.message_id
        });
        
    } catch (error) {
        console.error('[SKETCHER ERROR]', error.message);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        
        if (error.message.includes('sharp')) {
            const sent = await bot.sendMessage(chatId, 
                `Sharp library not installed.\n\n` +
                `Run: npm install sharp to enable sketch feature.`,
                { parse_mode: 'Markdown' }
            );
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
        } else {
            const sent = await bot.sendMessage(chatId, `Failed to create sketch. Please try again.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
        }
    }
});

// ─── OCR / SCAN ───
onCmd(/^\/scan(?:@\w+)?(?:\s|$)/, async (msg) => {
    const chatId = msg.chat.id;
    const replyMsg = msg.reply_to_message;
    
    if (!replyMsg) {
        const sent = await bot.sendMessage(chatId, 
            `Reply to an image with /scan\n\n` +
            `Send an image, then reply with: /scan\n` +
            `The text will be extracted from the image.`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    
    if (!replyMsg.photo && !(replyMsg.document && replyMsg.document.mime_type && replyMsg.document.mime_type.startsWith('image/'))) {
        const sent = await bot.sendMessage(chatId, 
            `Please reply to an IMAGE\n\n` +
            `Send a photo, then reply to it with /scan`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    
    const waitMsg = await bot.sendMessage(chatId, `Scanning image for text...`);
    
    try {
        let fileId;
        if (replyMsg.photo) {
            fileId = replyMsg.photo[replyMsg.photo.length - 1].file_id;
        } else {
            fileId = replyMsg.document.file_id;
        }
        
        const fileLink = await bot.getFileLink(fileId);
        const response = await fetch(fileLink);
        const buffer = Buffer.from(await response.arrayBuffer());
        
        let extractedText = null;
        
        try {
            const formData = new FormData();
            formData.append('apikey', 'K82707468388957');
            formData.append('language', 'eng');
            formData.append('isOverlayRequired', 'false');
            formData.append('file', buffer, { filename: 'scan.jpg' });
            
            const ocrResponse = await fetch('https://api.ocr.space/parse/image', {
                method: 'POST',
                body: formData,
                headers: formData.getHeaders ? formData.getHeaders() : {}
            });
            
            const data = await ocrResponse.json();
            if (data?.ParsedResults?.[0]?.ParsedText) {
                extractedText = data.ParsedResults[0].ParsedText.trim();
            }
        } catch (e) {
            console.log('[SCAN] OCR.space failed, trying fallback...');
        }
        
        if (!extractedText) {
            try {
                const base64 = buffer.toString('base64');
                const ocrResponse = await fetch('https://api.qrserver.com/v1/read-qr-code/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: base64, type: 'image' })
                });
                const data = await ocrResponse.json();
                if (data?.[0]?.symbol?.[0]?.data) {
                    extractedText = data[0].symbol[0].data;
                }
            } catch (e) {
                console.log('[SCAN] Fallback OCR failed');
            }
        }
        
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        
        if (!extractedText) {
            const sent = await bot.sendMessage(chatId, 
                `No text detected in the image.\n\n` +
                `Use a clear image with readable text.`,
                { parse_mode: 'Markdown' }
            );
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        
        await bot.sendMessage(chatId,
            `OCR RESULT\n\n` +
            `\`\`\`\n${extractedText}\n\`\`\``,
            { parse_mode: 'Markdown' }
        );
        
    } catch (error) {
        console.error('[SCAN ERROR]', error.message);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const sent = await bot.sendMessage(chatId, `OCR scan failed. Please try again.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── UNID ───
onCmd(/^\/unid(?:ownload)?(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const url = match[1] ? match[1].trim() : null;
    
    if (!url) {
        const sent = await bot.sendMessage(chatId,
            `Paste a URL with /unid\n\n` +
            `Usage: /unid <url>\n` +
            `Example: /unid https://vt.tiktok.com/xxxxx\n\n` +
            `Supports: TikTok, Instagram, YouTube, Twitter/X, Facebook`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return;
    }
    
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        const sent = await bot.sendMessage(chatId,
            `Please provide a valid URL\n\n` +
            `URL must start with http:// or https://\n\n` +
            `Example: /unid https://vt.tiktok.com/xxxxx`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    
    const waitMsg = await bot.sendMessage(chatId, `Downloading media...`);
    
    try {
        const apiUrl = `https://docs.prexzyapis.com/download/aio?url=${encodeURIComponent(url)}`;
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        
        if (!data.status || !data.medias || data.medias.length === 0) {
            const sent = await bot.sendMessage(chatId, `No media found for this URL.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        
        const video = data.medias.find(m => m.type === 'video' && m.is_no_watermark) || 
                     data.medias.find(m => m.type === 'video');
        const audio = data.medias.find(m => m.type === 'audio');
        
        const caption = `Downloaded\n˗ˏˋ☏ˎˊ˗ ${data.platform || 'Unknown'}\n☕︎ ${data.media_count || 1} media${data.media_count > 1 ? 's' : ''}`;
        
        if (video) {
            await bot.sendVideo(chatId, video.url, {
                caption: caption,
                parse_mode: 'Markdown',
                reply_to_message_id: msg.message_id
            });
        } else if (audio) {
            await bot.sendAudio(chatId, audio.url, {
                caption: caption,
                parse_mode: 'Markdown',
                reply_to_message_id: msg.message_id
            });
        } else if (data.medias[0] && data.medias[0].url) {
            await bot.sendMessage(chatId, 
                `${caption}\n\n▸ ${data.medias[0].url}`,
                { parse_mode: 'Markdown' }
            );
        } else {
            const sent = await bot.sendMessage(chatId, `Could not download media.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
        }
        
    } catch (error) {
        console.error('[UNID ERROR]', error.message);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const sent = await bot.sendMessage(chatId, `Download failed. Please check the URL.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── /lyrics — Search song lyrics ───
onCmd(/^\/lyrics(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1] ? match[1].trim() : null;
    
    if (!query) {
        const sent = await bot.sendMessage(chatId,
            `ⓘ **Search Lyrics**\n\n  Usage: /lyrics <song name or artist>\n  Example: /lyrics Davido Assurance`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    
    const waitMsg = await bot.sendMessage(chatId, `☻ Searching lyrics for "${query}"...`);
    
    try {
        const axios = require('axios');
        const response = await axios.get('https://prexzyapis.com/search/lyrics', {
            params: { title: query },
            timeout: 10000
        });
        
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        
        if (!response.data?.data?.lyrics) {
            const sent = await bot.sendMessage(chatId, `⚉ No lyrics found for "${query}"`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        
        const data = response.data.data;
        const lyrics = data.lyrics || data.syncedLyrics || '';
        const truncated = lyrics.length > 3000 ? lyrics.substring(0, 3000) + '...' : lyrics;
        
        let text = `🎵 **${data.title || 'Song'}**\n`;
        if (data.artist) text += `⌬ Artist: ${data.artist}\n`;
        if (data.album) text += `彡 Album: ${data.album}\n`;
        if (data.duration) text += `㋛ Duration: ${Math.floor(data.duration / 60)}:${String(data.duration % 60).padStart(2, '0')}\n`;
        text += `\n\`\`\`\n${truncated}\n\`\`\``;
        
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error('[LYRICS ERROR]', error.message);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const sent = await bot.sendMessage(chatId, `✘ Failed to search lyrics. Please try again.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});
// ─── TIKTOK SEARCH ───
onCmd(/^\/tt(?:search)?(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1] ? match[1].trim() : null;
    
    if (!query) {
        const sent = await bot.sendMessage(chatId,
            `Paste search query with /tt\n\n` +
            `Usage: /tt <search term>\n` +
            `/ttsearch <search term>\n\n` +
            `Example: /tt funny cats`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    
    const waitMsg = await bot.sendMessage(chatId, `Searching TikTok...`);
    
    try {
        const response = await fetch(`https://tikwm.com/api/feed/search?keywords=${encodeURIComponent(query)}&count=3`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        
        const data = await response.json();
        const videos = data?.data?.videos || [];
        
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        
        if (videos.length === 0) {
            try {
                const altResponse = await fetch(`https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(query)}&count=3`);
                const altData = await altResponse.json();
                const altVideos = altData?.data?.videos || [];
                
                if (altVideos.length > 0) {
                    for (const video of altVideos.slice(0, 2)) {
                        const videoUrl = video.play || video.wmplay;
                        if (videoUrl) {
                            await bot.sendVideo(chatId, videoUrl, {
                                caption: `TikTok: ${query}\n˗ˏˋ☏ˎˊ˗ @${video.author?.unique_id || 'unknown'}\n☕︎ ${video.duration || 0}s\nⓘ ${video.digg_count || 0} likes`,
                                parse_mode: 'Markdown'
                            });
                            await new Promise(r => setTimeout(r, 500));
                        }
                    }
                    await bot.sendMessage(chatId, `Found ${altVideos.length} videos for "${query}"`);
                    return;
                }
            } catch (altError) {
                console.log('[TTSEARCH] Alt API failed:', altError.message);
            }
            
            const sent = await bot.sendMessage(chatId, 
                `No TikTok videos found for "${query}".\n\n` +
                `Try a different search term.`,
                { parse_mode: 'Markdown' }
            );
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        
        let sentCount = 0;
        for (const video of videos.slice(0, 2)) {
            const videoUrl = video.play || video.wmplay;
            if (videoUrl) {
                try {
                    await bot.sendVideo(chatId, videoUrl, {
                        caption: `TikTok: ${query}\n˗ˏˋ☏ˎˊ˗ @${video.author?.unique_id || 'unknown'}\n☕︎ ${video.duration || 0}s\n☻ ${video.digg_count || 0} likes`,
                        parse_mode: 'Markdown'
                    });
                    sentCount++;
                    await new Promise(r => setTimeout(r, 500));
                } catch (e) {
                    console.error('Failed to send video:', e.message);
                }
            }
        }
        
        if (sentCount === 0) {
            const sent = await bot.sendMessage(chatId, `Could not display videos. Try again with a different search term.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
        } else {
            await bot.sendMessage(chatId, `Showing ${sentCount} of ${videos.length} videos for "${query}"`);
        }
        
    } catch (error) {
        console.error('[TTSEARCH ERROR]', error.message);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const sent = await bot.sendMessage(chatId, `Failed to search TikTok. Try again later.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── WALLPAPER ───
onCmd(/^\/wallpaper(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1] ? match[1].trim() : null;
    
    if (!query) {
        const sent = await bot.sendMessage(chatId,
            `Paste search query with /wallpaper\n\n` +
            `Usage: /wallpaper <query>\n` +
            `Example: /wallpaper nature`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    
    const waitMsg = await bot.sendMessage(chatId, `Searching wallpapers...`);
    
    try {
        let results = [];
        
        try {
            const response = await fetch(`https://wallpaper.crysnovax.link/api/search?query=${encodeURIComponent(query)}`);
            const data = await response.json();
            if (data?.results && data.results.length > 0) results = data.results;
        } catch (e) {
            console.log('[WALLPAPER] Primary API failed, trying fallback...');
        }
        
        if (results.length === 0) {
            try {
                const response = await fetch(`https://wallhaven.cc/api/v1/search?q=${encodeURIComponent(query)}&sorting=relevance&order=desc`);
                const data = await response.json();
                if (data?.data && data.data.length > 0) {
                    results = data.data.map(wp => ({ proxy: wp.path, url: wp.url, title: query }));
                }
            } catch (e) {
                console.log('[WALLPAPER] Wallhaven fallback failed');
            }
        }
        
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        
        if (results.length === 0) {
            const sent = await bot.sendMessage(chatId, 
                `No wallpapers found for "${query}".\n\n` +
                `Try a different search term.`,
                { parse_mode: 'Markdown' }
            );
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        
        let sentCount = 0;
        for (const wp of results.slice(0, 5)) {
            try {
                const button = {
                    inline_keyboard: [[
                        { text: '☕︎ Download', url: wp.proxy || wp.url }
                    ]]
                };
                
                await bot.sendPhoto(chatId, wp.proxy || wp.url, {
                    caption: `Wallpaper: ${query}\n☕︎ ${results.length} found`,
                    parse_mode: 'Markdown',
                    reply_markup: button
                });
                sentCount++;
                await new Promise(r => setTimeout(r, 500));
            } catch (e) {
                console.error('Wallpaper send failed:', e.message);
            }
        }
        
        if (sentCount === 0) {
            const sent = await bot.sendMessage(chatId, `Could not display wallpapers. Try a different search.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
        }
        
    } catch (error) {
        console.error('[WALLPAPER ERROR]', error.message);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const sent = await bot.sendMessage(chatId, `Failed to fetch wallpapers. Try again later.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── MOVIE SEARCH ───
onCmd(/^\/movie(?:intel)?(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1] ? match[1].trim() : null;
    
    if (!query) {
        const sent = await bot.sendMessage(chatId,
            `Paste search query with /movie\n\n` +
            `Usage: /movie <movie name>\n` +
            `/movieintel <movie name>\n\n` +
            `Example: /movie The Matrix`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    
    const waitMsg = await bot.sendMessage(chatId, `Searching for "${query}"...`);
    
    try {
        const response = await fetch(`https://docs.prexzyapis.com/moviesearch?query=${encodeURIComponent(query)}`);
        const data = await response.json();
        
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        
        if (!data.status || !data.results || data.results.length === 0) {
            const sent = await bot.sendMessage(chatId, `No results found for "${query}"`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        
        const results = data.results.slice(0, 5);
        
        for (const movie of results) {
            let caption = `🎬 ${movie.title}`;
            if (movie.year) caption += ` (${movie.year})`;
            caption += `\n\n`;
            
            if (movie.rating) caption += `Rating: ${movie.rating}\n`;
            if (movie.duration) caption += `Duration: ${movie.duration}\n`;
            if (movie.quality) caption += `Quality: ${movie.quality}\n`;
            if (movie.categories && movie.categories.length) {
                caption += `Genres: ${movie.categories.join(', ')}\n`;
            }
            if (movie.plot) {
                caption += `\nPlot: ${movie.plot.substring(0, 200)}${movie.plot.length > 200 ? '...' : ''}\n`;
            }
            
            const buttons = [];
            if (movie.url) buttons.push({ text: '˗ˏˋ☏ˎˊ˗ Watch Now', url: movie.url });
            if (movie.trailerUrl) buttons.push({ text: '☕︎ Trailer', url: movie.trailerUrl });
            
            if (movie.thumbnail) {
                await bot.sendPhoto(chatId, movie.thumbnail, {
                    caption: caption,
                    parse_mode: 'Markdown',
                    reply_markup: buttons.length > 0 ? { inline_keyboard: [buttons] } : undefined
                });
            } else {
                await bot.sendMessage(chatId, caption, {
                    parse_mode: 'Markdown',
                    reply_markup: buttons.length > 0 ? { inline_keyboard: [buttons] } : undefined,
                    disable_web_page_preview: true
                });
            }
            
            await new Promise(r => setTimeout(r, 300));
        }
        
        await bot.sendMessage(chatId, `Found ${data.total_results || results.length} results for "${query}"`);
        
    } catch (error) {
        console.error('[MOVIEINTEL ERROR]', error.message);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const sent = await bot.sendMessage(chatId, `Failed to fetch movies. Please try again.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── LIVEMATCH ───
onCmd(/^\/livematch(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const teamFilter = match[1] ? match[1].trim() : '';
    
    const waitMsg = await bot.sendMessage(chatId, `Fetching live matches...`);
    
    try {
        let matches = [];
        
        try {
            const primaryUrl = teamFilter 
                ? `https://docs.prexzyapis.com/sports/football?detail=${encodeURIComponent(teamFilter)}`
                : 'https://docs.prexzyapis.com/sports/football';
            
            const response = await fetch(primaryUrl);
            const data = await response.json();
            
            if (data?.data?.matches) {
                matches = data.data.matches.map(match => ({
                    team1: match.homeName || 'Unknown',
                    team2: match.awayName || 'Unknown',
                    league: match.leagueEn || 'N/A',
                    status: match.state === 1 ? 'Live' : match.state === 3 ? 'Half Time' : match.state === -1 ? 'Finished' : 'Scheduled',
                    score: `${match.homeScore || 0} - ${match.awayScore || 0}`,
                    time: match.state === 1 ? `${Math.floor((Date.now() - match.startTime_t) / 60000)}'` : match.state === 3 ? 'HT' : match.state === -1 ? 'FT' : 'N/A'
                }));
            }
            
            if (matches.length === 0) throw new Error('No matches');
        } catch (primaryError) {
            console.log('[LIVEMATCH] Fallback to crysnovax API');
            const fallbackUrl = `https://livematch.crysnovax.workers.dev/?team=${encodeURIComponent(teamFilter)}`;
            const response = await fetch(fallbackUrl);
            const data = await response.json();
            matches = Array.isArray(data) ? data : (data.matches || []);
        }
        
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        
        if (!matches || matches.length === 0) {
            const sent = await bot.sendMessage(chatId, 
                `No live matches found${teamFilter ? ` for "${teamFilter}"` : ''}`,
                { parse_mode: 'Markdown' }
            );
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        
        const displayMatches = teamFilter ? matches : matches.slice(0, 10);
        
        for (const m of displayMatches) {
            let matchText = `⚽ ${m.team1} vs ${m.team2}\n\n`;
            matchText += `League: ${m.league}\n`;
            matchText += `Status: ${m.status}\n`;
            matchText += `Score: ${m.score}\n`;
            if (m.time && m.time !== 'N/A') matchText += `Time: ${m.time}\n`;
            matchText += `\n`;
            
            let statusEmoji = '⏳';
            if (m.status === 'Live') statusEmoji = '🔴';
            else if (m.status === 'Half Time') statusEmoji = '⏸️';
            else if (m.status === 'Finished') statusEmoji = '✅';
            
            matchText += `${statusEmoji} ${m.status}`;
            
            await bot.sendMessage(chatId, matchText, { parse_mode: 'Markdown' });
        }
        
        await bot.sendMessage(chatId,
            `Showing ${displayMatches.length} match${displayMatches.length > 1 ? 'es' : ''}${teamFilter ? `\nFilter: "${teamFilter}"` : ''}`,
            { parse_mode: 'Markdown' }
        );
        
    } catch (error) {
        console.error('[LIVEMATCH ERROR]', error.message);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const sent = await bot.sendMessage(chatId, 
            `Failed to fetch live matches.\n\n` +
            `Try: /livematch <team name> to search\n` +
            `Try again later.`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── TTS (Text to Speech) - FIXED ───
onCmd(/^\/tts(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1] ? match[1].trim() : null;
    
    let text = input;
    let voice = 'male';
    
    if (text && /^(male|female)\s/.test(text)) {
        const possibleVoice = text.split(/\s+/)[0].toLowerCase();
        if (['male', 'female'].includes(possibleVoice)) {
            voice = possibleVoice;
            text = text.slice(possibleVoice.length).trim();
        }
    }
    
    if (!text) {
        const sent = await bot.sendMessage(chatId,
            `Text to Speech\n\n` +
            `Usage:\n` +
            `/tts <text>\n` +
            `/tts male <text>\n` +
            `/tts female <text>\n\n` +
            `Examples:\n` +
            `/tts Hello world\n` +
            `/tts male Hey man\n` +
            `/tts female Hello there`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    
    const waitMsg = await bot.sendMessage(chatId, `Generating speech...`);
    const stopRecording = startPresenceLoop(chatId, 'record_voice');
    
    try {
        let audioBuffer = null;
        let apiUrl;
        
        if (voice === 'female') {
            apiUrl = `https://docs.prexzyapis.com/tts/tts-en?text=${encodeURIComponent(text)}`;
        } else {
            apiUrl = `https://docs.prexzyapis.com/tts/james?text=${encodeURIComponent(text)}`;
        }
        
        const response = await fetch(apiUrl);
        if (response.ok) {
            audioBuffer = Buffer.from(await response.arrayBuffer());
        }
        
        stopRecording();
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        
        if (!audioBuffer) {
            const sent = await bot.sendMessage(chatId, `TTS failed. Please try again later.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        
        await bot.sendVoice(chatId, audioBuffer, {
      //      caption: `${voice} voice: ${text.substring(0, 100)}`,
            reply_to_message_id: msg.message_id
        });
        
    } catch (error) {
        stopRecording();
        console.error('[TTS ERROR]', error.message);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const sent = await bot.sendMessage(chatId, `TTS failed. Please try again later.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── TEMPEMAIL ��──
onCmd(/^\/tempemail(?:@\w+)?(?:\s+(\S+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = String(msg.from.id);
    const action = match[1] ? match[1].toLowerCase() : null;
    
    try {
        if (!action || action === 'create') {
            const domainRes = await fetch('https://api.mail.tm/domains');
            const domainData = await domainRes.json();
            const domain = domainData['hydra:member'][0].domain;
            
            const user = Math.random().toString(36).slice(2, 10);
            const email = `${user}@${domain}`;
            const password = Math.random().toString(36).slice(2, 12);
            
            await fetch('https://api.mail.tm/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address: email, password })
            });
            
            const tokenRes = await fetch('https://api.mail.tm/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address: email, password })
            });
            const tokenData = await tokenRes.json();
            
            tempEmails[userId] = { email, token: tokenData.token };
            
            await bot.sendMessage(chatId,
                `Temp Email Created\n\n` +
                `📧 Email: \`${email}\`\n` +
                `☕︎ Password: \`${password}\`\n\n` +
                `Commands:\n` +
                `/tempemail check - Check inbox\n` +
                `/tempemail read <id> - Read message`,
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        if (action === 'check') {
            const data = tempEmails[userId];
            if (!data) {
                const sent = await bot.sendMessage(chatId, `No temp email. Create one with /tempemail`);
                setTimeout(() => {
                    bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                }, 5000);
                return;
            }
            
            const res = await fetch('https://api.mail.tm/messages', {
                headers: { Authorization: `Bearer ${data.token}` }
            });
            const inbox = await res.json();
            const messages = inbox['hydra:member'] || [];
            
            if (messages.length === 0) {
                const sent = await bot.sendMessage(chatId, `Inbox empty`);
                setTimeout(() => {
                    bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                }, 5000);
                return;
            }
            
            let text = `Inbox (${messages.length} messages)\n\n`;
            messages.slice(0, 10).forEach((mail, i) => {
                text += `${i + 1}. ${mail.subject || 'No subject'}\n`;
                text += `   ☕︎ ${mail.from?.address || 'Unknown'}\n\n`;
            });
            text += `Use /tempemail read <id> to read`;
            
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
            return;
        }
        
        if (action === 'read') {
            const id = parseInt(match[2] || '0');
            if (!id) {
                const sent = await bot.sendMessage(chatId, `Usage: /tempemail read <number>`);
                setTimeout(() => {
                    bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                }, 5000);
                return;
            }
            
            const data = tempEmails[userId];
            if (!data) {
                const sent = await bot.sendMessage(chatId, `No temp email. Create one with /tempemail`);
                setTimeout(() => {
                    bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                }, 5000);
                return;
            }
            
            const inboxRes = await fetch('https://api.mail.tm/messages', {
                headers: { Authorization: `Bearer ${data.token}` }
            });
            const inbox = await inboxRes.json();
            const messages = inbox['hydra:member'] || [];
            
            if (id < 1 || id > messages.length) {
                const sent = await bot.sendMessage(chatId, `Invalid ID. Inbox has ${messages.length} messages.`);
                setTimeout(() => {
                    bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                }, 5000);
                return;
            }
            
            const mailId = messages[id - 1].id;
            const res = await fetch(`https://api.mail.tm/messages/${mailId}`, {
                headers: { Authorization: `Bearer ${data.token}` }
            });
            const mail = await res.json();
            
            const body = (mail.text || mail.html || 'No content').replace(/<[^>]*>/g, '').slice(0, 500);
            
            await bot.sendMessage(chatId,
                `Message ${id}\n\n` +
                `From: ${mail.from?.address || 'Unknown'}\n` +
                `Subject: ${mail.subject || 'No subject'}\n\n` +
                `Content:\n\`\`\`\n${body}\n\`\`\``,
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        const sent = await bot.sendMessage(chatId,
            `Temp Email Commands\n\n` +
            `/tempemail - Create email\n` +
            `/tempemail check - Check inbox\n` +
            `/tempemail read <id> - Read message`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        
    } catch (error) {
        console.error('[TEMPEMAIL ERROR]', error);
        const sent = await bot.sendMessage(chatId, `Temp email error. Please try again.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── GITHUB REPO SEARCH ─── (FIXED)

// ─── GITHUB REPO SEARCH ─── (FIXED)
// ─── GITHUB REPO SEARCH ─── (FIXED)
onCmd(/^\/github(?:search)?(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1] ? match[1].trim() : null;
    
    if (!query) {
        const sent = await bot.sendMessage(chatId,
            `Search GitHub repositories\n\n` +
            `Usage: /github <query>\n` +
            `Example: /github CRYSNIOVA_AI`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    
    const waitMsg = await bot.sendMessage(chatId, `Searching GitHub for "${query}"...`);
    
    try {
        let response = await fetch(`https://docs.prexzyapis.com/search/repos?query=${encodeURIComponent(query)}`);
        let data = await response.json();
        
        if (!data.status || !data.results || data.results.length === 0) {
            const githubResponse = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=5`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'PremiumBot/1.0'
                }
            });
            
            if (githubResponse.ok) {
                const githubData = await githubResponse.json();
                if (githubData.items && githubData.items.length > 0) {
                    data = {
                        status: true,
                        results: githubData.items.map(item => ({
                            name: item.name,
                            full_name: item.full_name,
                            description: item.description,
                            stars: item.stargazers_count,
                            url: item.html_url,
                            html_url: item.html_url,
                            language: item.language,
                            forks: item.forks_count,
                            owner: item.owner.login
                        }))
                    };
                }
            }
        }
        
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        
        if (!data.status || !data.results || data.results.length === 0) {
            const sent = await bot.sendMessage(chatId, 
                `No repositories found for "${query}"\n\nTry a different search term.`,
                { parse_mode: 'Markdown' }
            );
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        
        const results = data.results.slice(0, 5);
        let text = `☕︎ GitHub Repositories: "${query}"\n\n`;
        
        results.forEach((repo, i) => {
            // Handle both Prexzy and GitHub API formats
            const repoName = repo.name || repo.hl_name || repo.full_name || 'Unknown';
            const repoUrl = repo.url || repo.html_url || (repo.repo?.repository?.id ? `https://github.com/${repo.hl_name}` : null);
            const repoStars = repo.stars || repo.followers || 0;
            const repoLang = repo.language || 'Unknown';
            const repoDesc = repo.description || repo.hl_trunc_description || 'No description';
            const repoOwner = repo.owner || repo.repo?.repository?.owner_login || 'Unknown';
            
            text += `${i + 1}. *${repoName}*\n`;
            text += `   亗 Owner: ${repoOwner}\n`;
            text += `   ⌬ ${repoDesc.slice(0, 150)}${repoDesc.length > 150 ? '...' : ''}\n`;
            text += `   ⊕ ${repoStars} stars\n`;
            text += `   ☢︎ ${repoLang}\n`;
            if (repo.forks) text += `   🍴 ${repo.forks} forks\n`;
            if (repoUrl) text += `   ☁︎ [Visit](${repoUrl})\n`;
            text += `\n`;
        });
        
        let summary = `\n✆ *Quick Links:*\n`;
        results.forEach((repo, i) => {
            const repoName = repo.name || repo.full_name || 'Unknown';
            const repoUrl = repo.url || repo.html_url || null;
            if (repoUrl) {
                summary += `   ${i + 1}. [${repoName}](${repoUrl})\n`;
            }
        });
        text += summary;
        
        await bot.sendMessage(chatId, text, { 
            parse_mode: 'Markdown',
            disable_web_page_preview: false 
        });
        
    } catch (error) {
        console.error('[GITHUB ERROR]', error.message);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        
        try {
            const directResponse = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=3`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'PremiumBot/1.0'
                }
            });
            
            if (directResponse.ok) {
                const directData = await directResponse.json();
                if (directData.items && directData.items.length > 0) {
                    let text = `☢︎ GitHub Repositories: "${query}"\n\n`;
                    directData.items.slice(0, 5).forEach((repo, i) => {
                        text += `${i + 1}. ${repo.name}\n`;
                        text += `   亗 ${repo.owner.login}\n`;
                        text += `   ⊗ ${repo.description || 'No description'}\n`;
                        text += `   ㋛ ${repo.stargazers_count} stars\n`;
                        text += `   么 ${repo.html_url}\n\n`;
                    });
                    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
                    return;
                }
            }
        } catch (e) {
            console.log('[GITHUB] Direct API also failed');
        }
        
        const sent = await bot.sendMessage(chatId, 
            `Failed to search GitHub. Please try again later.\n\n` +
            `Try: /github CODY\n` +
            `Or search directly on GitHub.`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});
                    
        

// ─── TELEGRAM GROUP SEARCH ───
onCmd(/^\/tggroup(?:search)?(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1] ? match[1].trim() : null;
    
    if (!query) {
        const sent = await bot.sendMessage(chatId,
            `Search Telegram groups\n\n` +
            `Usage: /tggroup <query>\n` +
            `Example: /tggroup AI`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    
    const waitMsg = await bot.sendMessage(chatId, `Searching Telegram groups...`);
    
    try {
        const response = await fetch(`https://docs.prexzyapis.com/search/tggroup?query=${encodeURIComponent(query)}`);
        const data = await response.json();
        
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        
        if (!data.status || !data.results || data.results.length === 0) {
            const sent = await bot.sendMessage(chatId, `No groups found for "${query}"`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        
        const results = data.results.slice(0, 5);
        let text = `Telegram Groups: "${query}"\n\n`;
        
        results.forEach((group, i) => {
            text += `${i + 1}. ${group.name || 'Unknown'}\n`;
            if (group.username) text += `   ⓘ @${group.username}\n`;
            if (group.members) text += `   ☕︎ ${group.members} members\n`;
            if (group.description) text += `   ⌬ ${group.description.slice(0, 100)}...\n`;
            if (group.link) text += `   ⇆ ${group.link}\n`;
            text += `\n`;
        });
        
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error('[TGSEARCH ERROR]', error.message);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const sent = await bot.sendMessage(chatId, `Failed to search Telegram groups. Please try again.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ─── AIEDIT ───
onCmd(/^\/aiedit(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const prompt = match[1] ? match[1].trim() : null;
    const replyMsg = msg.reply_to_message;
    let imageUrl = null;
    
    if (replyMsg) {
        if (replyMsg.photo) {
            const fileId = replyMsg.photo[replyMsg.photo.length - 1].file_id;
            try {
                const fileLink = await bot.getFileLink(fileId);
                imageUrl = fileLink;
            } catch (e) {
                imageUrl = fileId;
            }
        } else if (replyMsg.document && replyMsg.document.mime_type && replyMsg.document.mime_type.startsWith('image/')) {
            const fileId = replyMsg.document.file_id;
            try {
                const fileLink = await bot.getFileLink(fileId);
                imageUrl = fileLink;
            } catch (e) {
                imageUrl = fileId;
            }
        }
    }
    
    if (!imageUrl && prompt && /^https?:\/\//i.test(prompt)) {
        imageUrl = prompt.trim();
    }
    
    if (!imageUrl) {
        const sent = await bot.sendMessage(chatId,
            `AI Image Editor\n\n` +
            `Edit images with AI!\n\n` +
            `Usage:\n` +
            `  1. Reply to an image with: /aiedit <prompt>\n` +
            `  2. Or: /aiedit <image_url> <prompt>\n\n` +
            `Examples:\n` +
            `  (Reply to image) /aiedit Make it red\n` +
            `  /aiedit https://example.com/photo.jpg Make it look like a painting\n\n` +
            `Powered by AI`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    
    let editPrompt = prompt;
    if (editPrompt) {
        editPrompt = editPrompt.replace(/(https?:\/\/[^\s]+)/, '').trim();
    }
    
    if (!editPrompt) {
        editPrompt = 'Make this image look more vibrant';
    }
    
    const waitMsg = await bot.sendMessage(chatId, 
        `Editing your image with AI...\n` +
        `Prompt: "${editPrompt}"\n\n` +
        `Please wait...`,
        { parse_mode: 'Markdown' }
    );
    
    try {
        const encodedImage = encodeURIComponent(imageUrl);
        const encodedPrompt = encodeURIComponent(editPrompt);
        const apiUrl = `https://docs.prexzyapis.com/ai/unlimai?image=${encodedImage}&prompt=${encodedPrompt}`;
        
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        
        if (!data.status || !data.data || !data.data.result_url) {
            throw new Error(data.message || 'API returned an error');
        }
        
        const resultUrl = data.data.result_url;
        const description = data.data.description || 'Image edited successfully!';
        
        const caption = `AI Image Editor\n\n` +
            `Prompt: ${editPrompt}\n\n` +
            `${description}\n\n` +
            `Powered by AI`;
        
        await bot.sendPhoto(chatId, resultUrl, {
            caption: caption,
            parse_mode: 'Markdown',
            reply_to_message_id: msg.message_id,
            reply_markup: {
                inline_keyboard: [[
                    { text: '⎙ Download', url: resultUrl }
                ]]
            }
        });
        
    } catch (error) {
        console.error('[AIEDIT ERROR]', error.message);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const sent = await bot.sendMessage(chatId,
            `Image editing failed.\n\n` +
            `Error: ${error.message}\n\n` +
            `Try using a different image or prompt.`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ============================================================
// 🔍 SEARCH COMMAND ───
// ============================================================

function extractOgImage(html) {
    const patterns = [
        /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
        /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
        /<meta[^>]*property=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
        /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']twitter:image["']/i,
        /<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
        /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1] && match[1].startsWith('http')) return match[1];
    }
    return null;
}

async function downloadBuffer(url) {
    try {
        const res = await require('axios').get(url, {
            responseType: 'arraybuffer',
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 8000
        });
        return Buffer.from(res.data);
    } catch {
        return null;
    }
}

async function getFaviconBuffer(url) {
    try {
        const domain = new URL(url).origin;
        const res = await require('axios').get(`https://www.google.com/s2/favicons?sz=256&domain_url=${domain}`, {
            responseType: 'arraybuffer',
            timeout: 8000
        });
        return Buffer.from(res.data);
    } catch {
        return null;
    }
}

onCmd(/^\/search(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1] ? match[1].trim() : null;
    if (!query) {
        const sent = await bot.sendMessage(chatId,
            `Web Search\n\n  Advanced web search with detailed results\n\n  Usage: /search <query>\n  Example: /search latest AI news`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const waitMsg = await bot.sendMessage(chatId, `Searching for "${query}"...`);
    try {
        const axios = require('axios');
        const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
        const res = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 15000
        });
        const html = res.data;
        const results = [];
        const regex = /<a[^>]*href="[^"]*uddg=([^"&]+)[^"]*"[^>]*>(.*?)<\/a>/g;
        let m;
        while ((m = regex.exec(html)) !== null) {
            const link = decodeURIComponent(m[1]);
            const title = m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
            if (link && title && !results.find(r => r.url === link)) {
                results.push({ title, url: link });
            }
        }
        if (results.length === 0) {
            await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
            const sent = await bot.sendMessage(chatId, `No results found.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        const selected = results.slice(0, 10);
        const pages = await Promise.all(
            selected.map(r =>
                axios.get(r.url, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    timeout: 8000
                }).then(res => res.data).catch(() => null)
            )
        );
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        let text = `SEARCH: ${query.toUpperCase()}\n\n`;
        selected.forEach((r, i) => {
            let content = '';
            if (pages[i]) {
                content = pages[i]
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .substring(0, 200);
            }
            text += `${i + 1}. ${r.title}\n  ⓘ ${r.url}\n${content ? `  ☕︎  ${content}...\n` : ''}\n`;
        });
        let thumbnail = null;
        let ogImageUrl = null;
        if (pages[0]) {
            ogImageUrl = extractOgImage(pages[0]);
        }
        if (!ogImageUrl) {
            for (let i = 1; i < pages.length; i++) {
                if (pages[i]) {
                    ogImageUrl = extractOgImage(pages[i]);
                    if (ogImageUrl) break;
                }
            }
        }
        if (ogImageUrl) {
            thumbnail = await downloadBuffer(ogImageUrl);
        }
        if (!thumbnail) {
            thumbnail = await getFaviconBuffer(selected[0].url);
        }
        if (thumbnail) {
            await bot.sendPhoto(chatId, thumbnail, {
                caption: text,
                parse_mode: 'Markdown'
            }).catch(() => {
                return bot.sendMessage(chatId, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
            });
        } else {
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
        }
    } catch (err) {
        console.error('[SEARCH ERROR]', err.message);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        const sent = await bot.sendMessage(chatId, `Search failed.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ============================================================
// 🎮 GAME FUNCTIONS ───
// ============================================================

// ─── WORD CHAIN ───
const WORDCHAIN_TIMEOUT_MS = 60 * 1000;

async function isValidWord(word) {
    try {
        const res = await require('axios').get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, { timeout: 5000 });
        return res.status === 200 && Array.isArray(res.data) && res.data.length > 0;
    } catch (e) {
        return false;
    }
}

async function processWordChain(msg, group, chatId) {
    const text = msg.text.trim().toLowerCase();
    const userId = msg.from.id;
    const userName = msg.from.first_name || msg.from.username || 'Player';
    if (text.startsWith('/')) return false;
    if (text.startsWith('!')) return false;
    const state = group.gameState;
    if (!state || state.type !== 'wordchain' || !state.active) return false;
    if (state.eliminated && state.eliminated.has(String(userId))) return false;
    if (!text.startsWith(state.lastLetter)) return false;
    if (state.usedWords.has(text)) {
        if (!state.eliminated) state.eliminated = new Set();
        state.eliminated.add(String(userId));
        saveDB();
        const sent = await bot.sendMessage(chatId, `"${text}" was already used!\n  ${userName} is eliminated!\n\n  Next word must start with ${state.lastLetter.toUpperCase()}`, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            // ─── Delete user's message ───
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return true;
    }
    const valid = await isValidWord(text);
    if (!valid) {
        if (!state.eliminated) state.eliminated = new Set();
        state.eliminated.add(String(userId));
        saveDB();
        const sent = await bot.sendMessage(chatId, `"${text}" is not a valid word!\n  ${userName} is eliminated!\n\n  Next word must start with ${state.lastLetter.toUpperCase()}`, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return true;
    }
    state.usedWords.add(text);
    state.lastWord = text;
    state.lastLetter = text.slice(-1).toLowerCase();
    state.currentPlayerId = userId;
    state.currentPlayerName = userName;
    state.round++;
    saveDB();
    addGameScore(group, userId, 'wordchain', 1);
    saveDB();
    if (wordChainTimers[chatId]) {
        clearTimeout(wordChainTimers[chatId]);
    }
    wordChainTimers[chatId] = setTimeout(async () => {
        const currentGroup = getGroup(chatId);
        if (currentGroup.gameState && currentGroup.gameState.active && currentGroup.gameState.type === 'wordchain') {
            const sent = await bot.sendMessage(chatId, `Time's up!\n\n  No one answered. The game continues!\n  Next word must start with ${currentGroup.gameState.lastLetter.toUpperCase()}`, { parse_mode: 'Markdown' });
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            }, 10000);
        }
    }, WORDCHAIN_TIMEOUT_MS);
    const sent = await bot.sendMessage(chatId,
        `${text.toUpperCase()} — Valid!\n  ${userName} (+1 point)\n\n  Round ${state.round} — Next word must start with ${state.lastLetter.toUpperCase()}`,
        { parse_mode: 'Markdown' }
    );
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 10000);
    return true;
}

onCmd(/^\/wordchain(?:@\w+)?(?:\s+(\S+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `Games only work in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (!(await isAdmin(chatId, userId)) && match[1]) {
        const cmd = (match[1] || '').toLowerCase();
        if (cmd === 'stop' || cmd === 'score') {
            const sent = await bot.sendMessage(chatId, `Only admins can control the game.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
    }
    const group = getGroup(chatId);
    const sub = (match[1] || '').toLowerCase();
    if (sub === 'score') {
        const sent = await bot.sendMessage(chatId, formatLeaderboard(getGameLeaderboard(group, 'wordchain'), 'Word Chain'));
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 30000);
        return;
    }
    if (sub === 'stop') {
        if (group.gameState && group.gameState.type === 'wordchain') {
            if (wordChainTimers[chatId]) {
                clearTimeout(wordChainTimers[chatId]);
                delete wordChainTimers[chatId];
            }
            group.gameState = null;
            saveDB();
            const sent = await bot.sendMessage(chatId, `Word Chain ended.\n\n  Thanks for playing!`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 10000);
            return;
        }
        const sent = await bot.sendMessage(chatId, `No word chain game is active.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (sub === 'start') {
        if (group.gameState && group.gameState.active) {
            const sent = await bot.sendMessage(chatId, `A game is already active: ${group.gameState.type}\n  Use /${group.gameState.type.split(' ')[0]} stop to end it.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 10000);
            return;
        }
        const startWord = 'hello';
        group.gameState = {
            type: 'wordchain',
            active: true,
            lastWord: startWord,
            lastLetter: startWord.slice(-1).toLowerCase(),
            usedWords: new Set([startWord]),
            currentPlayerId: null,
            currentPlayerName: null,
            round: 1,
            eliminated: new Set()
        };
        saveDB();
        const text = `${E.sparkle} WORD CHAIN STARTED ${E.sparkle}\n\n  Starting word: ${startWord}\n  Next word must start with: ${group.gameState.lastLetter.toUpperCase()}\n  You have 60 seconds per turn\n\n  Send a word starting with ${group.gameState.lastLetter.toUpperCase()}!\n  Invalid words = elimination. Last player standing wins!`;
        const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 30000);
        return;
    }
    const sent = await bot.sendMessage(chatId,
        `${E.sparkle} Word Chain ${E.sparkle}\n\n  /wordchain start — Start game\n  /wordchain stop — End game\n  /wordchain score — Leaderboard\n\n  Players send words starting with the last letter. Invalid = eliminated!`,
        { parse_mode: 'Markdown' }
    );
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 30000);
});

// ─── TRIVIA ───
const TRIVIA_QUESTION_DELAY = 5000;

function decodeHtmlEntities(text) {
    const entities = {
        '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&eacute;': 'é',
        '&iacute;': 'í', '&oacute;': 'ó', '&uacute;': 'ú', '&ntilde;': 'ñ', '&uuml;': 'ü',
        '&auml;': 'ä', '&ouml;': 'ö', '&aring;': 'å', '&aelig;': 'æ', '&oslash;': 'ø',
        '&hellip;': '\u2026', '&ldquo;': '\u201C', '&rdquo;': '\u201D', '&lsquo;': '\u2018', '&rsquo;': '\u2019'
    };
    return text.replace(/&[a-zA-Z0-9#]+;/g, e => entities[e] || e);
}

async function sendTriviaQuestion(chatId, group) {
    const state = group.gameState;
    if (!state || state.type !== 'trivia' || !state.active) return;
    if (state.questionNumber >= state.maxQuestions) {
        let summary = `TRIVIA BATTLE COMPLETE\n\n`;
        const scores = Object.entries(state.roundScores).sort((a, b) => b[1] - a[1]);
        if (scores.length === 0) {
            summary += `No one scored any points.`;
        } else {
            scores.forEach(([uid, score], i) => {
                const medals = ['🥇', '🥈', '🥉'];
                const prefix = medals[i] || `${i + 1}.`;
                const name = getUserName(group, uid);
                summary += `${prefix} ${name} ��� ${score} pts\n`;
                addGameScore(group, uid, 'trivia', score);
            });
        }
        summary += `\nUse /trivia score to see overall leaderboard.`;
        group.gameState = null;
        saveDB();
        if (triviaTimers[chatId]) delete triviaTimers[chatId];
        const sent = await bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        }, 30000);
        return;
    }
    try {
        const axios = require('axios');
        const res = await axios.get('https://opentdb.com/api.php?amount=1&type=multiple', { timeout: 10000 });
        const q = res.data.results[0];
        if (!q) throw new Error('No question returned');
        state.questionNumber++;
        state.currentAnswer = q.correct_answer;
        state.answered = new Set();
        state.correctUserId = null;
        const allAnswers = [...q.incorrect_answers, q.correct_answer].sort(() => Math.random() - 0.5);
        const correctIndex = allAnswers.indexOf(q.correct_answer);
        const letters = ['A', 'B', 'C', 'D'];
        state.currentOptions = allAnswers;
        state.correctLetter = letters[correctIndex];
        let text = `Question ${state.questionNumber}/${state.maxQuestions}\n\n${decodeHtmlEntities(q.question)}\n\n`;
        allAnswers.forEach((ans, i) => {
            text += `${letters[i]}. ${decodeHtmlEntities(ans)}\n`;
        });
        text += `\nReply with A, B, C, or D! You have 15 seconds.`;
        saveDB();
        const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        const questionTimeout = setTimeout(async () => {
            if (group.gameState && group.gameState.type === 'trivia' && group.gameState.questionNumber === state.questionNumber) {
                const decodedAnswer = decodeHtmlEntities(state.currentAnswer);
                const sent2 = await bot.sendMessage(chatId, `Time's up!\n\nThe correct answer was ${state.correctLetter} — ${decodedAnswer}\n\nNext question coming up...`, { parse_mode: 'Markdown' });
                setTimeout(() => {
                    bot.deleteMessage(chatId, sent2.message_id).catch(() => {});
                }, 10000);
                const nextTimeout = setTimeout(() => {
                    const refreshedGroup = getGroup(chatId);
                    sendTriviaQuestion(chatId, refreshedGroup);
                }, TRIVIA_QUESTION_DELAY);
                triviaTimers[chatId] = { questionTimeout, nextTimeout };
            }
        }, 15000);
        triviaTimers[chatId] = { questionTimeout, nextTimeout: null };
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        }, 20000);
    } catch (e) {
        console.error('Trivia error:', e.message);
        const sent = await bot.sendMessage(chatId, `Failed to fetch trivia question. Try again later.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        }, 5000);
        group.gameState = null;
        saveDB();
    }
}

async function processTrivia(msg, group, chatId) {
    const text = msg.text.trim().toUpperCase();
    const userId = msg.from.id;
    const userName = msg.from.first_name || msg.from.username || 'Player';
    const state = group.gameState;
    if (!state || state.type !== 'trivia' || !state.active) return false;
    if (!state.currentAnswer) return false;
    if (state.correctUserId) return false;
    if (state.answered && state.answered.has(String(userId))) return false;
    const validAnswers = ['A', 'B', 'C', 'D'];
    if (!validAnswers.includes(text)) return false;
    state.answered.add(String(userId));
    if (text === state.correctLetter) {
        state.correctUserId = userId;
        if (!state.roundScores) state.roundScores = {};
        state.roundScores[String(userId)] = (state.roundScores[String(userId)] || 0) + 1;
        saveDB();
        const decodedAnswer = decodeHtmlEntities(state.currentAnswer);
        if (triviaTimers[chatId]) {
            clearTimeout(triviaTimers[chatId].questionTimeout);
        }
        const sent = await bot.sendMessage(chatId,
            `Correct! ${userName} answered ${state.correctLetter} — ${decodedAnswer}\n+1 point!\n\nNext question coming up...`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        const nextTimeout = setTimeout(() => {
            const refreshedGroup = getGroup(chatId);
            sendTriviaQuestion(chatId, refreshedGroup);
        }, TRIVIA_QUESTION_DELAY);
        triviaTimers[chatId] = { questionTimeout: null, nextTimeout };
        return true;
    } else {
        return true;
    }
}

onCmd(/^\/trivia(?:@\w+)?(?:\s+(\S+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `Games only work in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const group = getGroup(chatId);
    const sub = (match[1] || '').toLowerCase();
    if (sub === 'score') {
        const sent = await bot.sendMessage(chatId, formatLeaderboard(getGameLeaderboard(group, 'trivia'), 'Trivia Battle'));
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 30000);
        return;
    }
    if (sub === 'stop') {
        if (!(await isAdmin(chatId, userId))) {
            const sent = await bot.sendMessage(chatId, `Only admins can stop the game.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        if (group.gameState && group.gameState.type === 'trivia') {
            if (triviaTimers[chatId]) {
                clearTimeout(triviaTimers[chatId].questionTimeout);
                clearTimeout(triviaTimers[chatId].nextTimeout);
                delete triviaTimers[chatId];
            }
            group.gameState = null;
            saveDB();
            const sent = await bot.sendMessage(chatId, `${E.sparkle} Trivia Battle ended.\n\n  Thanks for playing!`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 10000);
            return;
        }
        const sent = await bot.sendMessage(chatId, `No trivia game is active.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (sub === 'start') {
        if (!(await isAdmin(chatId, userId))) {
            const sent = await bot.sendMessage(chatId, `Only admins can start the game.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        if (group.gameState && group.gameState.active) {
            const sent = await bot.sendMessage(chatId, `A game is already active: ${group.gameState.type}\n  Use /${group.gameState.type.split(' ')[0]} stop to end it.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 10000);
            return;
        }
        group.gameState = {
            type: 'trivia',
            active: true,
            currentQuestion: null,
            currentAnswer: null,
            questionNumber: 0,
            maxQuestions: 10,
            roundScores: {},
            answered: new Set(),
            correctUserId: null
        };
        saveDB();
        const sent = await bot.sendMessage(chatId,
            `${E.sparkle} TRIVIA BATTLE STARTED ${E.sparkle}\n\n  10 questions\n  First correct answer wins the point\n  Answer with A, B, C, or D\n\n  Starting in 3 seconds...`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        setTimeout(() => sendTriviaQuestion(chatId, group), 3000);
        return;
    }
    const sent = await bot.sendMessage(chatId,
        `${E.sparkle} Trivia Battle ${E.sparkle}\n\n  /trivia start — Start game (admin)\n  /trivia stop — End game (admin)\n  /trivia score — Leaderboard`,
        { parse_mode: 'Markdown' }
    );
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 30000);
});

// ─── GUESS THE NUMBER ───
function processGuessNumber(msg, group, chatId) {
    const text = msg.text.trim();
    const userId = msg.from.id;
    const userName = msg.from.first_name || msg.from.username || 'Player';
    if (text.startsWith('/')) return false;
    if (text.startsWith('!')) return false;
    const guess = parseInt(text, 10);
    if (isNaN(guess) || guess < 1 || guess > 100) return false;
    const state = group.gameState;
    if (!state || state.type !== 'guessnumber' || !state.active) return false;
    if (state.winnerId) return false;
    state.guesses++;
    state.lastGuess = guess;
    saveDB();
    if (guess === state.target) {
        state.winnerId = userId;
        const elapsed = ((Date.now() - state.startedAt) / 1000).toFixed(1);
        addGameScore(group, userId, 'guessnumber', 1);
        saveDB();
        const sent = bot.sendMessage(chatId,
            `${E.sparkle} CORRECT! ${E.sparkle}\n\n  ${userName} guessed ${guess} in ${state.guesses} tries!\n  Time: ${elapsed}s\n\n  🏆 Winner!`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 30000);
        group.gameState = null;
        saveDB();
        return true;
    } else if (guess < state.target) {
        const sent = bot.sendMessage(chatId, `  ${userName}: ${guess} — Go higher!`, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return true;
    } else {
        const sent = bot.sendMessage(chatId, `  ${userName}: ${guess} — Go lower!`, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return true;
    }
}

onCmd(/^\/guessnumber(?:@\w+)?(?:\s+(\S+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `Games only work in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const group = getGroup(chatId);
    const sub = (match[1] || '').toLowerCase();
    if (sub === 'stop') {
        if (!(await isAdmin(chatId, userId))) {
            const sent = await bot.sendMessage(chatId, `Only admins can stop the game.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        if (group.gameState && group.gameState.type === 'guessnumber') {
            group.gameState = null;
            saveDB();
            const sent = await bot.sendMessage(chatId, `${E.sparkle} Guess the Number ended.\n\n  Thanks for playing!`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 10000);
            return;
        }
        const sent = await bot.sendMessage(chatId, `No active guessing game.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (sub === 'start') {
        if (!(await isAdmin(chatId, userId))) {
            const sent = await bot.sendMessage(chatId, `Only admins can start the game.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        if (group.gameState && group.gameState.active) {
            const sent = await bot.sendMessage(chatId, `A game is already active: ${group.gameState.type}`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        const target = Math.floor(Math.random() * 100) + 1;
        group.gameState = {
            type: 'guessnumber',
            active: true,
            target,
            guesses: 0,
            startedAt: Date.now(),
            winnerId: null,
            lastGuess: null
        };
        saveDB();
        const sent = await bot.sendMessage(chatId,
            `${E.sparkle} GUESS THE NUMBER ${E.sparkle}\n\n  I'm thinking of a number between 1 and 100!\n\n  Send your guess in chat\n  I'll say "higher" or "lower"\n  First to guess wins!\n\n  Start guessing now!`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 30000);
        return;
    }
    const sent = await bot.sendMessage(chatId,
        `${E.sparkle} Guess the Number ${E.sparkle}\n\n  /guessnumber start — Start game (admin)\n  /guessnumber stop — End game (admin)`,
        { parse_mode: 'Markdown' }
    );
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 30000);
});

// ─── EMOJI RIDDLES ───
const EMOJI_ROUND_TIME = 20000;

async function sendEmojiRiddle(chatId, group) {
    const state = group.gameState;
    if (!state || state.type !== 'emoji' || !state.active) return;
    if (state.round >= state.maxRounds) {
        const sent = await bot.sendMessage(chatId, `${E.sparkle} Emoji Riddles Complete!\n\n  Use /emoji score to see the leaderboard.`, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        }, 10000);
        group.gameState = null;
        saveDB();
        if (emojiTimers[chatId]) delete emojiTimers[chatId];
        return;
    }
    const available = EMOJI_RIDDLES.filter((_, i) => !state.usedRiddles.has(i));
    if (available.length === 0) {
        state.usedRiddles.clear();
    }
    const riddleIndex = EMOJI_RIDDLES.findIndex((_, i) => !state.usedRiddles.has(i));
    if (riddleIndex === -1) {
        const sent = await bot.sendMessage(chatId, `${E.sparkle} That's all the riddles!\n\n  Use /emoji score to see the leaderboard.`, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        }, 10000);
        group.gameState = null;
        saveDB();
        return;
    }
    const riddle = EMOJI_RIDDLES[riddleIndex];
    state.round++;
    state.currentRiddle = riddle;
    state.currentAnswer = riddle.answers[0];
    state.solved = false;
    state.usedRiddles.add(riddleIndex);
    saveDB();
    const text = `${E.sparkle} Riddle ${state.round}/${state.maxRounds} ${E.sparkle}\n\n  ${riddle.emojis}\n\n  What movie/phrase do these emojis represent?\n  You have 20 seconds!`;
    const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
    }, 25000);
    emojiTimers[chatId] = setTimeout(async () => {
        const refreshedGroup = getGroup(chatId);
        if (refreshedGroup.gameState && refreshedGroup.gameState.type === 'emoji' &&
            refreshedGroup.gameState.round === state.round && !refreshedGroup.gameState.solved) {
            const sent2 = await bot.sendMessage(chatId, `${E.sparkle} Time's up!\n\n  The answer was: ${state.currentAnswer}\n\n  Next riddle...`, { parse_mode: 'Markdown' });
            setTimeout(() => {
                bot.deleteMessage(chatId, sent2.message_id).catch(() => {});
            }, 10000);
            setTimeout(() => {
                const g = getGroup(chatId);
                sendEmojiRiddle(chatId, g);
            }, 3000);
        }
    }, EMOJI_ROUND_TIME);
}

function processEmojiRiddle(msg, group, chatId) {
    const text = msg.text.trim().toLowerCase();
    const userId = msg.from.id;
    const userName = msg.from.first_name || msg.from.username || 'Player';
    if (text.startsWith('/')) return false;
    if (text.startsWith('!')) return false;
    const state = group.gameState;
    if (!state || state.type !== 'emoji' || !state.active) return false;
    if (state.solved) return false;
    if (!state.currentRiddle) return false;
    const correct = state.currentRiddle.answers.some(ans => text === ans.toLowerCase() ||
        text.includes(ans.toLowerCase()));
    if (correct) {
        state.solved = true;
        addGameScore(group, userId, 'emoji', 1);
        saveDB();
        if (emojiTimers[chatId]) {
            clearTimeout(emojiTimers[chatId]);
        }
        const sent = bot.sendMessage(chatId,
            `${E.sparkle} Correct! ${E.sparkle}\n  ${userName} got it: ${state.currentAnswer} (+1)\n\n  Next riddle...`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        setTimeout(() => {
            const g = getGroup(chatId);
            sendEmojiRiddle(chatId, g);
        }, 3000);
        return true;
    }
    return false;
}

onCmd(/^\/emoji(?:@\w+)?(?:\s+(\S+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `Games only work in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const group = getGroup(chatId);
    const sub = (match[1] || '').toLowerCase();
    if (sub === 'score') {
        const sent = await bot.sendMessage(chatId, formatLeaderboard(getGameLeaderboard(group, 'emoji'), 'Emoji Riddles'));
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 30000);
        return;
    }
    if (sub === 'stop') {
        if (!(await isAdmin(chatId, userId))) {
            const sent = await bot.sendMessage(chatId, `Only admins can stop the game.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        if (group.gameState && group.gameState.type === 'emoji') {
            if (emojiTimers[chatId]) {
                clearTimeout(emojiTimers[chatId]);
                delete emojiTimers[chatId];
            }
            group.gameState = null;
            saveDB();
            const sent = await bot.sendMessage(chatId, `${E.sparkle} Emoji Riddles ended.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 10000);
            return;
        }
        const sent = await bot.sendMessage(chatId, `No active emoji riddle game.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (sub === 'start') {
        if (!(await isAdmin(chatId, userId))) {
            const sent = await bot.sendMessage(chatId, `Only admins can start the game.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        if (group.gameState && group.gameState.active) {
            const sent = await bot.sendMessage(chatId, `A game is already active: ${group.gameState.type}`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        group.gameState = {
            type: 'emoji',
            active: true,
            currentRiddle: null,
            currentAnswer: null,
            round: 0,
            maxRounds: 10,
            solved: false,
            usedRiddles: new Set()
        };
        saveDB();
        const sent = await bot.sendMessage(chatId,
            `${E.sparkle} EMOJI RIDDLES STARTED ${E.sparkle}\n\n  10 emoji puzzles\n  First correct answer wins the point\n  Type your answer in chat\n\n  Starting in 3 seconds...`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        setTimeout(() => sendEmojiRiddle(chatId, group), 3000);
        return;
    }
    const sent = await bot.sendMessage(chatId,
        `${E.sparkle} Emoji Riddles ${E.sparkle}\n\n  /emoji start — Start game (admin)\n  /emoji stop — End game (admin)\n  /emoji score — Leaderboard`,
        { parse_mode: 'Markdown' }
    );
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 30000);
});

// ─── HANGMAN ───
function processHangman(msg, group, chatId) {
    const text = msg.text.trim().toLowerCase();
    const userId = msg.from.id;
    const userName = msg.from.first_name || msg.from.username || 'Player';
    if (text.startsWith('/')) return false;
    if (text.startsWith('!')) return false;
    if (text.length !== 1 || !/[a-z]/.test(text)) return false;
    const state = group.gameState;
    if (!state || state.type !== 'hangman' || !state.active) return false;
    if (state.won) return false;
    if (state.wrongGuesses >= state.maxWrong) return false;
    const letter = text;
    if (state.guessed.has(letter)) {
        const sent = bot.sendMessage(chatId, `  Letter "${letter.toUpperCase()}" was already guessed!\n\n  Word: ${state.display}`, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return true;
    }
    state.guessed.add(letter);
    if (state.word.includes(letter)) {
        let newDisplay = '';
        for (const char of state.word) {
            if (state.guessed.has(char)) {
                newDisplay += char.toUpperCase() + ' ';
            } else {
                newDisplay += '_ ';
            }
        }
        newDisplay = newDisplay.trim();
        state.display = newDisplay;
        if (!newDisplay.includes('_')) {
            state.won = true;
            addGameScore(group, userId, 'hangman', 1);
            saveDB();
            const sent = bot.sendMessage(chatId,
                `${E.sparkle} YOU WON! ${E.sparkle}\n\n${HANGMAN_STAGES[state.wrongGuesses]}\n\n  Word: ${state.word.toUpperCase()}\n  ${userName} solved it! (+1)\n\n  🎪 Victory!`,
                { parse_mode: 'Markdown' }
            );
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 30000);
            group.gameState = null;
            saveDB();
            return true;
        }
        saveDB();
        const sent = bot.sendMessage(chatId,
            `${E.sparkle} "${letter.toUpperCase()}" is correct!\n\n${HANGMAN_STAGES[state.wrongGuesses]}\n\n  Word: ${state.display}\n  Wrong: ${state.wrongGuesses}/${state.maxWrong}\n  Guessed: ${Array.from(state.guessed).join(', ').toUpperCase()}`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return true;
    } else {
        state.wrongGuesses++;
        if (state.wrongGuesses >= state.maxWrong) {
            saveDB();
            const sent = bot.sendMessage(chatId,
                `${E.sparkle} GAME OVER ${E.sparkle}\n\n${HANGMAN_STAGES[6]}\n\n  The word was: ${state.word.toUpperCase()}\n\n  Better luck next time!`,
                { parse_mode: 'Markdown' }
            );
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 30000);
            group.gameState = null;
            saveDB();
            return true;
        }
        saveDB();
        const sent = bot.sendMessage(chatId,
            `${E.sparkle} "${letter.toUpperCase()}" is wrong!\n\n${HANGMAN_STAGES[state.wrongGuesses]}\n\n  Word: ${state.display}\n  Wrong: ${state.wrongGuesses}/${state.maxWrong}\n  Guessed: ${Array.from(state.guessed).join(', ').toUpperCase()}`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        return true;
    }
}

onCmd(/^\/hangman(?:@\w+)?(?:\s+(\S+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `Games only work in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const group = getGroup(chatId);
    const sub = (match[1] || '').toLowerCase();
    if (sub === 'score') {
        const sent = await bot.sendMessage(chatId, formatLeaderboard(getGameLeaderboard(group, 'hangman'), 'Hangman'));
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 30000);
        return;
    }
    if (sub === 'stop') {
        if (!(await isAdmin(chatId, userId))) {
            const sent = await bot.sendMessage(chatId, `Only admins can stop the game.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        if (group.gameState && group.gameState.type === 'hangman') {
            group.gameState = null;
            saveDB();
            const sent = await bot.sendMessage(chatId, `${E.sparkle} Hangman ended.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 10000);
            return;
        }
        const sent = await bot.sendMessage(chatId, `No active hangman game.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (sub === 'start') {
        if (!(await isAdmin(chatId, userId))) {
            const sent = await bot.sendMessage(chatId, `Only admins can start the game.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        if (group.gameState && group.gameState.active) {
            const sent = await bot.sendMessage(chatId, `A game is already active: ${group.gameState.type}`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        const word = HANGMAN_WORDS[Math.floor(Math.random() * HANGMAN_WORDS.length)];
        const display = '_ '.repeat(word.length).trim();
        group.gameState = {
            type: 'hangman',
            active: true,
            word,
            guessed: new Set(),
            wrongGuesses: 0,
            maxWrong: 6,
            won: false,
            display
        };
        saveDB();
        const text = `${E.sparkle} HANGMAN STARTED ${E.sparkle}\n\n${HANGMAN_STAGES[0]}\n\n  Word: ${display}\n  Length: ${word.length} letters\n  Wrong: 0/6\n\n  Send a single letter to guess!`;
        const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 30000);
        return;
    }
    const sent = await bot.sendMessage(chatId,
        `${E.sparkle} Hangman ${E.sparkle}\n\n  /hangman start — Start game (admin)\n  /hangman stop — End game (admin)\n  /hangman score — Leaderboard\n\n  Guess one letter at a time. 6 wrong = game over!`,
        { parse_mode: 'Markdown' }
    );
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 30000);
});

// ─── FAST MATH ───
const MATH_QUESTION_DELAY = 4000;
const MATH_ANSWER_TIME = 12000;

function generateMathExpression() {
    const ops = ['+', '-', '*'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    let a, b;
    switch (op) {
        case '+':
            a = Math.floor(Math.random() * 50) + 1;
            b = Math.floor(Math.random() * 50) + 1;
            break;
        case '-':
            a = Math.floor(Math.random() * 50) + 10;
            b = Math.floor(Math.random() * a);
            break;
        case '*':
            a = Math.floor(Math.random() * 12) + 2;
            b = Math.floor(Math.random() * 12) + 2;
            break;
    }
    const expression = `${a} ${op} ${b}`;
    const answer = eval(expression);
    return { expression, answer };
}

async function sendMathQuestion(chatId, group) {
    const state = group.gameState;
    if (!state || state.type !== 'math' || !state.active) return;
    if (state.questionNumber >= state.maxQuestions) {
        let summary = `FAST MATH COMPLETE\n\n`;
        const scores = Object.entries(state.roundScores).sort((a, b) => b[1] - a[1]);
        if (scores.length === 0) {
            summary += `No one scored any points.`;
        } else {
            scores.forEach(([uid, score], i) => {
                const medals = ['🥇', '🥈', '🥉'];
                const prefix = medals[i] || `${i + 1}.`;
                const name = getUserName(group, uid);
                summary += `${prefix} ${name} — ${score} pts\n`;
                addGameScore(group, uid, 'math', score);
            });
        }
        summary += `\nUse /math score to see overall leaderboard.`;
        group.gameState = null;
        saveDB();
        if (mathTimers[chatId]) delete mathTimers[chatId];
        const sent = await bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        }, 30000);
        return;
    }
    const { expression, answer } = generateMathExpression();
    state.questionNumber++;
    state.currentExpression = expression;
    state.currentAnswer = answer;
    state.answered = false;
    saveDB();
    const text = `Question ${state.questionNumber}/${state.maxQuestions}\n\nWhat is ${expression}?\n\nYou have 12 seconds!`;
    const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    const questionTimeout = setTimeout(async () => {
        const g = getGroup(chatId);
        if (g.gameState && g.gameState.type === 'math' && g.gameState.questionNumber === state.questionNumber && !g.gameState.answered) {
            g.gameState.streakHolder = null;
            g.gameState.streakCount = 0;
            saveDB();
            const sent2 = await bot.sendMessage(chatId, `Time's up!\n\nThe answer was ${state.currentAnswer}\n\nNext question...`, { parse_mode: 'Markdown' });
            setTimeout(() => {
                bot.deleteMessage(chatId, sent2.message_id).catch(() => {});
            }, 10000);
            const nextTimeout = setTimeout(() => {
                const refreshedGroup = getGroup(chatId);
                sendMathQuestion(chatId, refreshedGroup);
            }, MATH_QUESTION_DELAY);
            mathTimers[chatId] = { questionTimeout: null, nextTimeout };
        }
    }, MATH_ANSWER_TIME);
    mathTimers[chatId] = { questionTimeout, nextTimeout: null };
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
    }, 15000);
}

function processFastMath(msg, group, chatId) {
    const text = msg.text.trim();
    const userId = msg.from.id;
    const userName = msg.from.first_name || msg.from.username || 'Player';
    if (text.startsWith('/')) return false;
    if (text.startsWith('!')) return false;
    const answer = parseInt(text, 10);
    if (isNaN(answer)) return false;
    const state = group.gameState;
    if (!state || state.type !== 'math' || !state.active) return false;
    if (state.answered) return false;
    if (state.currentAnswer === null) return false;
    if (answer === state.currentAnswer) {
        state.answered = true;
        if (!state.roundScores) state.roundScores = {};
        let points = 1;
        if (state.streakHolder === userId) {
            state.streakCount++;
            if (state.streakCount >= 3) {
                points = 2;
                state.streakCount = 0;
            }
        } else {
            state.streakHolder = userId;
            state.streakCount = 1;
        }
        state.roundScores[String(userId)] = (state.roundScores[String(userId)] || 0) + points;
        saveDB();
        if (mathTimers[chatId]) {
            clearTimeout(mathTimers[chatId].questionTimeout);
        }
        const streakText = points > 1 ? ` 🔥 Streak bonus!` : '';
        const sent = bot.sendMessage(chatId,
            `Correct!${streakText}\n${userName}: ${state.currentExpression} = ${state.currentAnswer} (+${points})\n\nNext question...`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        const nextTimeout = setTimeout(() => {
            const refreshedGroup = getGroup(chatId);
            sendMathQuestion(chatId, refreshedGroup);
        }, MATH_QUESTION_DELAY);
        mathTimers[chatId] = { questionTimeout: null, nextTimeout };
        return true;
    }
    return false;
}

onCmd(/^\/math(?:@\w+)?(?:\s+(\S+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (msg.chat.type === 'private') {
        const sent = await bot.sendMessage(chatId, `Games only work in groups.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    const group = getGroup(chatId);
    const sub = (match[1] || '').toLowerCase();
    if (sub === 'score') {
        const sent = await bot.sendMessage(chatId, formatLeaderboard(getGameLeaderboard(group, 'math'), 'Fast Math'));
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 30000);
        return;
    }
    if (sub === 'stop') {
        if (!(await isAdmin(chatId, userId))) {
            const sent = await bot.sendMessage(chatId, `Only admins can stop the game.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        if (group.gameState && group.gameState.type === 'math') {
            if (mathTimers[chatId]) {
                clearTimeout(mathTimers[chatId].questionTimeout);
                clearTimeout(mathTimers[chatId].nextTimeout);
                delete mathTimers[chatId];
            }
            group.gameState = null;
            saveDB();
            const sent = await bot.sendMessage(chatId, `${E.sparkle} Fast Math ended.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 10000);
            return;
        }
        const sent = await bot.sendMessage(chatId, `No active math challenge.`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
        return;
    }
    if (sub === 'start') {
        if (!(await isAdmin(chatId, userId))) {
            const sent = await bot.sendMessage(chatId, `Only admins can start the game.`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        if (group.gameState && group.gameState.active) {
            const sent = await bot.sendMessage(chatId, `A game is already active: ${group.gameState.type}`);
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        group.gameState = {
            type: 'math',
            active: true,
            currentExpression: null,
            currentAnswer: null,
            questionNumber: 0,
            maxQuestions: 15,
            roundScores: {},
            streakHolder: null,
            streakCount: 0,
            answered: false
        };
        saveDB();
        const sent = await bot.sendMessage(chatId,
            `${E.sparkle} FAST MATH STARTED ${E.sparkle}\n\n  15 math expressions\n  First correct answer wins (+1 point)\n  Streak bonus: +1 extra per 3-in-a-row\n  12 seconds per question\n\n  Starting in 3 seconds...`,
            { parse_mode: 'Markdown' }
        );
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 10000);
        setTimeout(() => sendMathQuestion(chatId, group), 3000);
        return;
    }
    const sent = await bot.sendMessage(chatId,
        `${E.sparkle} Fast Math ${E.sparkle}\n\n  /math start — Start challenge (admin)\n  /math stop — End challenge (admin)\n  /math score — Leaderboard`,
        { parse_mode: 'Markdown' }
    );
    setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 30000);
});

// ─── WOULD YOU RATHER ─── (FIXED WITH KEYBOARD)
onCmd(/^\/wyr(?:@\w+)?(?:\s|$)/, async (msg) => {
    const chatId = msg.chat.id;
    
    const question = WYR_QUESTIONS[Math.floor(Math.random() * WYR_QUESTIONS.length)];
    
    const keyboard = {
        keyboard: [
            ['ⓘ Question', '✆ Menu'],
            ['✘ Cancel']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    };
    
    try {
        await bot.sendPoll(chatId, `Would you rather ${question.q}`, [question.a, question.b], {
            is_anonymous: false,
            allows_multiple_answers: false
        });
        await bot.sendMessage(chatId, `Choose an option:`, { reply_markup: keyboard });
    } catch (e) {
        const sent = await bot.sendMessage(chatId, `Failed to create WYR poll: ${e.message}`);
        setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 5000);
    }
});

// ============================================================
// 📨 MAIN MESSAGE HANDLER ───
// ============================================================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Track before any setup/command branch can return early.
    premiumStore.observe(msg).catch(error => console.error('Premium store observation failed:', error.message));
    collectPremiumEmoji(msg);
    if (msg.from && !msg.from.is_bot) {
        if (msg.chat.type === 'private') trackDMUser(msg.from.id);
        else trackMember(chatId, msg.from);
    }

    // ─── FIX: broadcast photo/video has no msg.text, so it must be handled
    // before the text guard below or it silently gets dropped ───
    if (!text && pendingBroadcastSetup[chatId] &&
        pendingBroadcastSetup[chatId].step === 'message_input' &&
        pendingBroadcastSetup[chatId].ppEnabled &&
        captureBroadcastMedia(msg)) {
        const setup = pendingBroadcastSetup[chatId];
        setup.media = captureBroadcastMedia(msg);
        // If the media arrived with its own caption, keep it (and its
        // formatting entities) so the admin can send in one step.
        if (typeof msg.caption === 'string' && msg.caption.length) {
            setup.message = msg.caption;
            setup.entities = msg.caption_entities || [];
        }
        setup.step = 'message_text';
        await bot.sendMessage(chatId, '✅ Media received! Now send the broadcast message (or send "skip" to use the caption / no text):', {
            reply_markup: { remove_keyboard: true }
        });
        return;
    }

    if (!text) {
        // ─── NOSTICKER ───
        // Stickers carry no msg.text, so this must run before the text-only
        // guard below — otherwise sticker messages return early and this
        // code never executes.
        if (msg.chat.type !== 'private' && msg.sticker) {
            const group = getGroup(chatId);
            if (group.nostickerEnabled) {
                const senderIsAdmin = await isAdmin(chatId, msg.from.id);
                if (!senderIsAdmin) {
                    try {
                        await bot.deleteMessage(chatId, msg.message_id);
                        const warn = await bot.sendMessage(chatId, `ⓘ Stickers are not allowed here, ${getUserLink(msg.from)}.`, {
                            parse_mode: 'Markdown'
                        });
                        setTimeout(() => {
                            bot.deleteMessage(chatId, warn.message_id).catch(() => {});
                        }, 5000);
                    } catch (e) {
                        console.error('Failed to delete sticker:', e.message);
                    }
                }
            }
        }
        return;
    }

    // ─── KEYBOARD BUTTON HANDLER ───
    if (KEYBOARD_COMMANDS.includes(text)) {
        if (['Status', 'Refresh', 'Users'].includes(text) && !isProtectedOwner(msg.from.id)) {
            await bot.sendMessage(chatId, 'Owner only.');
            return;
        }
        if (text === 'Status') {
            const uptime = formatUptime(process.uptime());
            const ram = getRAM();
            const statusMsg = `Bot Status\n\nStatus: Online\nUptime: ${uptime}\nRAM: ${ram}\nUser ID: ${msg.from.id}\nChat ID: ${chatId}`;
            await bot.sendMessage(chatId, statusMsg, { parse_mode: 'Markdown' });
            setTimeout(() => {
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        if (text === 'Settings') {
            await showSettings(msg);
            return;
        }
        if (text === 'Users') {
            await showUsersList(msg);
            return;
        }
        if (text === 'Refresh') {
            loadDB();
            const statusMsg = `Cache Refreshed\n\nDatabase reloaded\nGroups: ${Object.keys(db).length}\nDM Users: ${dmUsers.size}\nPremium Emojis: ${Object.keys(PREMIUM_EMOJIS).length}`;
            await bot.sendMessage(chatId, statusMsg, { parse_mode: 'Markdown' });
            setTimeout(() => {
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }
        if (text === 'Language') {
            await showLanguageMenu(msg);
            return;
        }
        if (text === 'Menu') {
            await showMenu(msg);
            return;
        }
        if (text === 'Close') {
            await bot.sendMessage(chatId, '▫️', {
                reply_markup: { remove_keyboard: true }
            });
            setTimeout(() => {
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 100);
            return;
        }
    }

    // ─── WYR KEYBOARD HANDLER ───
    if (text === 'ⓘ Question') {
        const question = WYR_QUESTIONS[Math.floor(Math.random() * WYR_QUESTIONS.length)];
        try {
            await bot.sendPoll(chatId, `Would you rather ${question.q}`, [question.a, question.b], {
                is_anonymous: false,
                allows_multiple_answers: false
            });
        } catch (e) {
            await bot.sendMessage(chatId, `Failed to create WYR poll: ${e.message}`);
        }
        return;
    }
    if (text === '✆ Menu') {
        await showMenu(msg);
        return;
    }
    if (text === '✘ Cancel') {
        await bot.sendMessage(chatId, '▫️', {
            reply_markup: { remove_keyboard: true }
        });
        setTimeout(() => {
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 100);
        return;
    }

    // ─── DIRECT @BOT AI QUERY ───
    const hasActiveSetup = pendingWelcomeSetup[chatId] || pendingCaptchaSetup[chatId] ||
        pendingSetWelcomeSetup[chatId] || pendingSetGoodbyeSetup[chatId] || pendingBroadcastSetup[chatId];
    if (!hasActiveSetup && msg.chat.type !== 'private' && msg.from && !msg.from.is_bot &&
        typeof text === 'string' && !text.startsWith('/') && !text.startsWith('!')) {
        const username = (BOT_USERNAME || EBOT_USERNAME.replace(/^@/, '')).toLowerCase();
        const mentionEntities = (msg.entities || []).filter(entity => entity.type === 'mention');
        const botMention = mentionEntities.find(entity =>
            text.substr(entity.offset, entity.length).toLowerCase() === `@${username}`
        );
        if (botMention) {
            const query = `${text.slice(0, botMention.offset)}${text.slice(botMention.offset + botMention.length)}`.trim();
            if (query) {
                await handleAIQuery(chatId, msg.message_id, query);
                return;
            }
        }
    }

    // ─── BROADCAST HANDLER ───
    if (pendingBroadcastSetup[chatId]) {
        const setup = pendingBroadcastSetup[chatId];
        const userId = msg.from.id;
        
        if (userId !== setup.userId) {
            return;
        }
        
        if (text === 'Cancel') {
            delete pendingBroadcastSetup[chatId];
            await bot.sendMessage(chatId, '▫️', {
                reply_markup: { remove_keyboard: true }
            });
            await bot.answerCallbackQuery(msg.message_id, {
                text: '✅ Broadcast cancelled successfully.',
                show_alert: true
            }).catch(() => {});
            setTimeout(() => {
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 100);
            return;
        }
        
        if (text === 'Back') {
            if (['button_count', 'button_url', 'button_name'].includes(setup.step)) {
                setup.step = 'button_choice';
                setup.buttons = [];
                setup.hasButton = false;
                const keyboard = {
                    keyboard: [['With Button', 'Without Button'], ['Cancel', 'Back']],
                    resize_keyboard: true
                };
                await bot.sendMessage(chatId, 'Button option:', { reply_markup: keyboard });
                return;
            }
            if (setup.step === 'button_choice') {
                setup.step = 'pp_choice';
                const keyboard = {
                    keyboard: [['With PP', 'Without PP'], ['Cancel']],
                    resize_keyboard: true
                };
                await bot.sendMessage(chatId, 'Choose profile picture option:', { reply_markup: keyboard });
                return;
            }
            if (setup.step === 'target_choice') {
                setup.step = 'button_choice';
                const keyboard = {
                    keyboard: [['With Button', 'Without Button'], ['Cancel', 'Back']],
                    resize_keyboard: true
                };
                await bot.sendMessage(chatId, 'Button option:', { reply_markup: keyboard });
                return;
            }
            if (setup.step === 'pp_choice') {
                delete pendingBroadcastSetup[chatId];
                await bot.sendMessage(chatId, '▫️', {
                    reply_markup: { remove_keyboard: true }
                });
                return;
            }
            return;
        }
        
        if (setup.step === 'pp_choice') {
            if (text === 'With PP' || text === 'Without PP') {
                setup.ppEnabled = text === 'With PP';
                setup.step = 'button_choice';
                const keyboard = {
                    keyboard: [['With Button', 'Without Button'], ['Cancel', 'Back']],
                    resize_keyboard: true
                };
                await bot.sendMessage(chatId, 'Button option:', { reply_markup: keyboard });
                return;
            }
            return;
        }
        
        if (setup.step === 'button_choice') {
            if (text === 'With Button') {
                setup.step = 'button_count';
                setup.buttons = [];
                await bot.sendMessage(chatId, 'How many buttons? Choose 1, 2, or 3:', {
                    reply_markup: { keyboard: [['1', '2', '3'], ['Cancel', 'Back']], resize_keyboard: true }
                });
                return;
            }
            if (text === 'Without Button') {
                setup.hasButton = false;
                setup.buttons = [];
                setup.step = 'target_choice';
                const keyboard = {
                    keyboard: [['DMs Only', 'Groups Only'], ['Both', 'Cancel', 'Back']],
                    resize_keyboard: true
                };
                await bot.sendMessage(chatId, 'Where to send:', { reply_markup: keyboard });
                return;
            }
            return;
        }

        if (setup.step === 'button_count') {
            const count = Number(text);
            if (![1, 2, 3].includes(count)) {
                await bot.sendMessage(chatId, 'Choose a button count of 1, 2, or 3.');
                return;
            }
            setup.buttonCount = count;
            setup.currentButton = 0;
            setup.buttons = [];
            setup.step = 'button_url';
            await bot.sendMessage(chatId, `Send URL for button 1 of ${count}:`, { reply_markup: { remove_keyboard: true } });
            return;
        }
        
        if (setup.step === 'button_url') {
            let parsed;
            try { parsed = new URL(text); } catch (error) { parsed = null; }
            if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
                await bot.sendMessage(chatId, 'Invalid URL. Must be a complete http:// or https:// URL.');
                return;
            }
            setup.pendingButtonUrl = parsed.toString();
            setup.step = 'button_name';
            await bot.sendMessage(chatId, `Send name for button ${setup.currentButton + 1} of ${setup.buttonCount}:`);
            return;
        }
        
        if (setup.step === 'button_name') {
            if (text.length < 1 || text.length > 50) {
                await bot.sendMessage(chatId, 'Button name must be 1-50 characters.');
                return;
            }
            setup.buttons.push({ text, url: setup.pendingButtonUrl });
            setup.currentButton++;
            if (setup.currentButton < setup.buttonCount) {
                setup.step = 'button_url';
                await bot.sendMessage(chatId, `Send URL for button ${setup.currentButton + 1} of ${setup.buttonCount}:`);
                return;
            }
            setup.hasButton = true;
            setup.step = 'target_choice';
            const keyboard = {
                keyboard: [['DMs Only', 'Groups Only'], ['Both', 'Cancel', 'Back']],
                resize_keyboard: true
            };
            await bot.sendMessage(chatId, 'Where to send:', { reply_markup: keyboard });
            return;
        }
        
        if (setup.step === 'target_choice') {
            if (text === 'DMs Only' || text === 'Groups Only' || text === 'Both') {
                setup.target = text;
                setup.step = 'message_input';
                if (setup.ppEnabled) {
                    await bot.sendMessage(chatId, 'Send me the media for the broadcast (photo, video, GIF, audio, voice, or file):', {
                        reply_markup: { remove_keyboard: true }
                    });
                } else {
                    await bot.sendMessage(chatId, 'Send me the broadcast message:', {
                        reply_markup: { remove_keyboard: true }
                    });
                }
                return;
            }
            return;
        }
        
        if (setup.step === 'message_input') {
            // Accept any media type: photo, video, animation/GIF, audio, voice,
            // video note, or document. Whatever the admin sends is re-broadcast
            // with the same type so audio/files work just like photos/videos.
            const captured = captureBroadcastMedia(msg);
            if (setup.ppEnabled && captured) {
                setup.media = captured;
                // If the media was sent WITH a caption, keep it (and its
                // formatting) so the admin doesn't have to re-type it.
                if (typeof msg.caption === 'string' && msg.caption.length) {
                    setup.message = msg.caption;
                    setup.entities = msg.caption_entities || [];
                }
                await bot.sendMessage(chatId, '✅ Media received! Now send the broadcast message (or send "skip" to keep the caption):', {
                    reply_markup: { remove_keyboard: true }
                });
                setup.step = 'message_text';
                return;
            }
            
            if (setup.ppEnabled && !captured) {
                await bot.sendMessage(chatId, 'ⓘ Please send media (photo, video, GIF, audio, voice, or file) for the broadcast.\n\nSend the media now:');
                return;
            }
            
            setup.message = text;
            setup.entities = msg.entities || [];
            setup.step = 'preview';
            const keyboard = {
                inline_keyboard: [
                    [{ text: '📤 Send', callback_data: 'broadcast_send' }],
                    [{ text: '⚇ Preview', callback_data: 'broadcast_preview' }],
                    [{ text: '✘ Cancel', callback_data: 'broadcast_cancel' }]
                ]
            };
            await bot.sendMessage(chatId, `Message received!\n\nTap Send to broadcast, Preview to see, or Cancel.`, {
                reply_markup: keyboard
            });
            return;
        }
        
        if (setup.step === 'message_text') {
            // "skip" keeps the caption already captured with the media.
            if (!(text && text.trim().toLowerCase() === 'skip')) {
                setup.message = text;
                setup.entities = msg.entities || [];
            }
            setup.step = 'preview';
            const keyboard = {
                inline_keyboard: [
                    [{ text: '📤 Send', callback_data: 'broadcast_send' }],
                    [{ text: '⚇ Preview', callback_data: 'broadcast_preview' }],
                    [{ text: '✘ Cancel', callback_data: 'broadcast_cancel' }]
                ]
            };
            await bot.sendMessage(chatId, `Message received!\n\nTap Send to broadcast, Preview to see, or Cancel.`, {
                reply_markup: keyboard
            });
            return;
        }
    }

    // ─── SETWELCOME HANDLER ───
    if (pendingSetWelcomeSetup[chatId]) {
        const setup = pendingSetWelcomeSetup[chatId];
        const userId = msg.from.id;
        if (userId !== setup.userId) return;
        
        if (text === 'Cancel') {
            delete pendingSetWelcomeSetup[chatId];
            await bot.sendMessage(chatId, '▫️', { reply_markup: { remove_keyboard: true } });
            setTimeout(() => {
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 100);
            return;
        }
        
        if (setup.step === 'pp_choice') {
            if (text === 'Use Default') {
                await confirmDefaultWelcome(msg, pendingSetWelcomeSetup);
                return;
            }
            if (text === 'With PP' || text === 'Without PP') {
                setup.ppEnabled = text === 'With PP';
                setup.step = 'button_choice';
                const keyboard = {
                    keyboard: [['With Button', 'Without Button'], ['Cancel']],
                    resize_keyboard: true
                };
                await bot.sendMessage(chatId, 'Welcome Button:', { reply_markup: keyboard });
                return;
            }
            return;
        }
        
        if (setup.step === 'button_choice') {
            if (text === 'With Button') {
                setup.step = 'button_url';
                await bot.sendMessage(chatId, 'Send me the URL for the button:', {
                    reply_markup: { remove_keyboard: true }
                });
                return;
            }
            if (text === 'Without Button') {
                setup.hasButton = false;
                setup.step = 'message_input';
                await bot.sendMessage(chatId, 'Send me the welcome message.\n\nPlaceholders: {name} and {group}', {
                    reply_markup: { remove_keyboard: true }
                });
                return;
            }
            return;
        }
        
        if (setup.step === 'button_url') {
            if (!text.startsWith('http://') && !text.startsWith('https://')) {
                await bot.sendMessage(chatId, 'Invalid URL. Must start with http:// or https://');
                return;
            }
            setup.buttonUrl = text;
            setup.step = 'button_name';
            await bot.sendMessage(chatId, 'Send me the name of the button:');
            return;
        }
        
        if (setup.step === 'button_name') {
            if (text.length < 1 || text.length > 50) {
                await bot.sendMessage(chatId, 'Button name must be 1-50 characters.');
                return;
            }
            setup.buttonName = text;
            setup.hasButton = true;
            setup.step = 'message_input';
            await bot.sendMessage(chatId, 'Send me the welcome message.\n\nPlaceholders: {name} and {group}');
            return;
        }
        
        if (setup.step === 'message_input') {
            const group = getGroup(chatId);
            group.welcomeMsg = text;
            group.welcomePPEnabled = setup.ppEnabled;
            if (setup.hasButton) {
                group.welcomeUrl = { text: setup.buttonName, url: setup.buttonUrl };
            } else {
                group.welcomeUrl = null;
            }
            saveDB();
            delete pendingSetWelcomeSetup[chatId];
            await bot.sendMessage(chatId, '▫️', { reply_markup: { remove_keyboard: true } });
            await bot.sendMessage(chatId, 
                `Welcome message saved!\n\nPreview:\n${text.replace('{name}', msg.from.first_name).replace('{group}', msg.chat.title || 'this group')}`,
                { parse_mode: 'Markdown' }
            );
            setTimeout(() => {
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 100);
            return;
        }
    }

    // ─── SETGOODBYE HANDLER ───
    if (pendingSetGoodbyeSetup[chatId]) {
        const setup = pendingSetGoodbyeSetup[chatId];
        const userId = msg.from.id;
        if (userId !== setup.userId) return;
        
        if (text === 'Cancel') {
            delete pendingSetGoodbyeSetup[chatId];
            await bot.sendMessage(chatId, '▫️', { reply_markup: { remove_keyboard: true } });
            setTimeout(() => {
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 100);
            return;
        }
        
        if (setup.step === 'pp_choice') {
            if (text === 'With PP' || text === 'Without PP') {
                setup.step = 'message_input';
                await bot.sendMessage(chatId, 'Send me the goodbye message.\n\nPlaceholders: {name} and {group}', {
                    reply_markup: { remove_keyboard: true }
                });
                return;
            }
            return;
        }
        
        if (setup.step === 'message_input') {
            const group = getGroup(chatId);
            group.goodbyeMsg = text;
            saveDB();
            delete pendingSetGoodbyeSetup[chatId];
            await bot.sendMessage(chatId, '▫���', { reply_markup: { remove_keyboard: true } });
            await bot.sendMessage(chatId, 
                `Goodbye message saved!\n\nPreview:\n${text.replace('{name}', msg.from.first_name).replace('{group}', msg.chat.title || 'this group')}`,
                { parse_mode: 'Markdown' }
            );
            setTimeout(() => {
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 100);
            return;
        }
    }

    // ─── TOGGLEWELCOME HANDLER ───
    if (pendingWelcomeSetup[chatId]) {
        const setup = pendingWelcomeSetup[chatId];
        const userId = msg.from.id;
        if (userId !== setup.userId) return;
        
        if (text === 'Cancel') {
            delete pendingWelcomeSetup[chatId];
            await bot.sendMessage(chatId, '▫️', { reply_markup: { remove_keyboard: true } });
            setTimeout(() => {
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 100);
            return;
        }
        
        if (text === 'Back') {
            if (setup.step === 'pp_choice') {
                setup.step = 'choose_type';
                const keyboard = {
                    keyboard: [['Set Welcome', 'Set Goodbye'], ['Cancel']],
                    resize_keyboard: true
                };
                await bot.sendMessage(chatId, 'Choose what to configure:', { reply_markup: keyboard });
                return;
            }
            if (setup.step === 'button_choice') {
                setup.step = 'pp_choice';
                const keyboard = {
                    keyboard: setup.type === 'welcome'
                        ? [['With PP', 'Without PP'], ['Use Default'], ['Cancel', 'Back']]
                        : [['With PP', 'Without PP'], ['Cancel', 'Back']],
                    resize_keyboard: true
                };
                await bot.sendMessage(chatId, 'Profile Picture:', { reply_markup: keyboard });
                return;
            }
            if (setup.step === 'message_input') {
                setup.step = 'button_choice';
                const keyboard = {
                    keyboard: [['With Button', 'Without Button'], ['Cancel', 'Back']],
                    resize_keyboard: true
                };
                await bot.sendMessage(chatId, 'Welcome Button:', { reply_markup: keyboard });
                return;
            }
            return;
        }
        
        if (setup.step === 'choose_type') {
            if (text === 'Set Welcome' || text === 'Set Goodbye') {
                setup.type = text === 'Set Welcome' ? 'welcome' : 'goodbye';
                setup.step = 'pp_choice';
                const keyboard = {
                    keyboard: setup.type === 'welcome'
                        ? [['With PP', 'Without PP'], ['Use Default'], ['Cancel', 'Back']]
                        : [['With PP', 'Without PP'], ['Cancel', 'Back']],
                    resize_keyboard: true
                };
                await bot.sendMessage(chatId, `Configuring ${text} Message\n\nProfile Picture:`, { reply_markup: keyboard });
                return;
            }
            return;
        }
        
        if (setup.step === 'pp_choice') {
            if (text === 'Use Default' && setup.type === 'welcome') {
                await confirmDefaultWelcome(msg, pendingWelcomeSetup);
                return;
            }
            if (text === 'With PP' || text === 'Without PP') {
                setup.ppEnabled = text === 'With PP';
                setup.step = 'button_choice';
                const keyboard = {
                    keyboard: [['With Button', 'Without Button'], ['Cancel', 'Back']],
                    resize_keyboard: true
                };
                await bot.sendMessage(chatId, 'Welcome Button:', { reply_markup: keyboard });
                return;
            }
            return;
        }
        
        if (setup.step === 'button_choice') {
            if (text === 'With Button') {
                setup.step = 'button_url';
                await bot.sendMessage(chatId, 'Send me the URL for the button:', {
                    reply_markup: { remove_keyboard: true }
                });
                return;
            }
            if (text === 'Without Button') {
                setup.hasButton = false;
                setup.step = 'message_input';
                const typeLabel = setup.type === 'welcome' ? 'Welcome' : 'Goodbye';
                await bot.sendMessage(chatId, `Send me the ${typeLabel.toLowerCase()} message.\n\nPlaceholders: {name} and {group}`, {
                    reply_markup: { remove_keyboard: true }
                });
                return;
            }
            return;
        }
        
        if (setup.step === 'button_url') {
            if (!text.startsWith('http://') && !text.startsWith('https://')) {
                await bot.sendMessage(chatId, 'Invalid URL. Must start with http:// or https://');
                return;
            }
            setup.buttonUrl = text;
            setup.step = 'button_name';
            await bot.sendMessage(chatId, 'Send me the name of the button:');
            return;
        }
        
        if (setup.step === 'button_name') {
            if (text.length < 1 || text.length > 50) {
                await bot.sendMessage(chatId, 'Button name must be 1-50 characters.');
                return;
            }
            setup.buttonName = text;
            setup.hasButton = true;
            setup.step = 'message_input';
            const typeLabel = setup.type === 'welcome' ? 'Welcome' : 'Goodbye';
            await bot.sendMessage(chatId, `Send me the ${typeLabel.toLowerCase()} message.\n\nPlaceholders: {name} and {group}`);
            return;
        }
        
        if (setup.step === 'message_input') {
            const group = getGroup(chatId);
            if (setup.type === 'welcome') {
                group.welcomeMsg = text;
                group.welcomePPEnabled = setup.ppEnabled;
                if (setup.hasButton) {
                    group.welcomeUrl = { text: setup.buttonName, url: setup.buttonUrl };
                } else {
                    group.welcomeUrl = null;
                }
            } else {
                group.goodbyeMsg = text;
            }
            saveDB();
            delete pendingWelcomeSetup[chatId];
            await bot.sendMessage(chatId, '▫️', { reply_markup: { remove_keyboard: true } });
            await bot.sendMessage(chatId, 
                `${setup.type === 'welcome' ? 'Welcome' : 'Goodbye'} message saved!\n\nPreview:\n${text.replace('{name}', msg.from.first_name).replace('{group}', msg.chat.title || 'this group')}`,
                { parse_mode: 'Markdown' }
            );
            setTimeout(() => {
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 100);
            return;
        }
    }

    // ─── TOGGLECAPTCHA HANDLER ───
    if (pendingCaptchaSetup[chatId]) {
        const setup = pendingCaptchaSetup[chatId];
        const userId = msg.from.id;
        if (userId !== setup.userId) return;
        
        if (text === 'Cancel') {
            delete pendingCaptchaSetup[chatId];
            await bot.sendMessage(chatId, '▫️', { reply_markup: { remove_keyboard: true } });
            setTimeout(() => {
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 100);
            return;
        }
        
        if (text === 'Use Default') {
            const group = getGroup(chatId);
            group.captchaEnabled = true;
            group.captchaType = 'default';
            group.captchaQuestion = null;
            group.captchaAnswer = null;
            group.captchaWrongAnswer = null;
            group.captchaAttempts = {};
            saveDB();
            delete pendingCaptchaSetup[chatId];
            await bot.sendMessage(chatId, '▫️', { reply_markup: { remove_keyboard: true } });
            await bot.sendMessage(chatId, 
                'Captcha set to default (arithmetic questions).\n\nNew members will be verified with simple math.\nThey get 3 attempts before being removed.'
            );
            return;
        }
        
        if (text === 'Set Question') {
            setup.step = 'question';
            await bot.sendMessage(chatId, 'Send me your custom captcha question:', {
                reply_markup: { remove_keyboard: true }
            });
            return;
        }
        
        if (setup.step === 'question') {
            setup.question = text;
            setup.step = 'answer';
            await bot.sendMessage(chatId, 'Send me the correct answer:');
            return;
        }
        
        if (setup.step === 'answer') {
            setup.answer = text;
            setup.step = 'wrong_answer';
            await bot.sendMessage(chatId, 'Send me a wrong answer to show alongside it:\n\n(New members are muted on join, so they verify by tapping the correct answer button — a wrong option is needed too.)');
            return;
        }
        
        if (setup.step === 'wrong_answer') {
            const group = getGroup(chatId);
            group.captchaEnabled = true;
            group.captchaType = 'custom';
            group.captchaQuestion = setup.question;
            group.captchaAnswer = setup.answer;
            group.captchaWrongAnswer = text;
            group.captchaAttempts = {};
            saveDB();
            delete pendingCaptchaSetup[chatId];
            await bot.sendMessage(chatId, '▫️', { reply_markup: { remove_keyboard: true } });
            await bot.sendMessage(chatId, 
                `Custom captcha saved!\n\nQuestion: ${setup.question}\nCorrect answer: ${setup.answer}\nWrong answer: ${text}\n\nNew members tap the correct answer button. They get 3 attempts before being removed.`
            );
            return;
        }
    }

    // ─── GROUP CHAT ───
    if (msg.chat.type !== 'private') {
        const group = getGroup(chatId);

        group.stats.messages++;
        group.stats.members[String(msg.from.id)] = (group.stats.members[String(msg.from.id)] || 0) + 1;
        saveDB();

        // ─── PREFIX CHECK ───
        const activePrefix = group.prefix || '/';
        if (msg.text && msg.text.startsWith('/') && activePrefix !== '/') {
            return;
        }
        if (msg.text && msg.text.startsWith('!') && activePrefix !== '!') {
            return;
        }

        // ─── NOSTICKER handled earlier (before the text-only guard), since
        // stickers carry no msg.text and never reach this point ───

        // ─── ANTITAG ───
        if (group.antitagEnabled && msg.text && !msg.text.startsWith('/') && !msg.text.startsWith('!')) {
            const entities = msg.entities || [];
            const mentionCount = entities.filter(e => e.type === 'mention' || e.type === 'text_mention').length;
            if (mentionCount >= ANTITAG_THRESHOLD) {
                let senderIsAdmin = false;
                try {
                    const member = await bot.getChatMember(chatId, msg.from.id);
                    senderIsAdmin = member.status === 'administrator' || member.status === 'creator';
                } catch (e) {}
                if (!senderIsAdmin) {
                    try {
                        await bot.deleteMessage(chatId, msg.message_id);
                        const sent = await bot.sendMessage(chatId, `${getUserLink(msg.from)}, mass-tagging (${mentionCount} mentions) isn't allowed here.`, { parse_mode: 'Markdown' });
                        setTimeout(() => {
                            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                        }, 10000);
                        sendLog(chatId, `Mass-tag removed from ${getUserLink(msg.from)} (${mentionCount} mentions)`);
                    } catch (e) {}
                    return;
                }
            }
        }

        // ─── ANTILINK ───
        if (group.antilinkEnabled && msg.text && LINK_REGEX.test(msg.text) && !msg.text.startsWith('/') && !msg.text.startsWith('!')) {
            const whitelisted = allLinksWhitelisted(msg.text, group.antilinkWhitelist);
            if (!whitelisted) {
                let senderIsAdmin = false;
                try {
                    const member = await bot.getChatMember(chatId, msg.from.id);
                    senderIsAdmin = member.status === 'administrator' || member.status === 'creator';
                } catch (e) {
                    senderIsAdmin = false;
                }
                if (!senderIsAdmin && !isProtectedOwner(msg.from.id)) {
                    const mode = group.antilinkMode || 'warn';
                    try {
                        await bot.deleteMessage(chatId, msg.message_id);
                    } catch (e) {}
                    if (mode === 'delete') {
                        sendLog(chatId, `Link deleted from ${getUserLink(msg.from)} (mode: delete)`);
                        return;
                    }
                    if (mode === 'kick') {
                        try {
                            await bot.banChatMember(chatId, msg.from.id);
                            await bot.unbanChatMember(chatId, msg.from.id);
                            const sent = await bot.sendMessage(chatId, `${getUserLink(msg.from)} was removed for sharing a link.`, { parse_mode: 'Markdown' });
                            setTimeout(() => {
                                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                            }, 10000);
                            sendLog(chatId, `Removed ${getUserLink(msg.from)} — link posted (mode: kick)`);
                        } catch (e) {}
                        return;
                    }
                    const key = String(msg.from.id);
                    group.warns[key] = (group.warns[key] || 0) + 1;
                    saveDB();
                    if (group.warns[key] >= MAX_WARNS) {
                        try {
                            await bot.banChatMember(chatId, msg.from.id);
                            await bot.unbanChatMember(chatId, msg.from.id);
                            delete group.warns[key];
                            saveDB();
                            const sent = await bot.sendMessage(chatId, `${getUserLink(msg.from)} was removed for repeatedly sharing links.`, { parse_mode: 'Markdown' });
                            setTimeout(() => {
                                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                            }, 10000);
                            sendLog(chatId, `Auto-removed ${getUserLink(msg.from)} — link spam (${MAX_WARNS} warns).`);
                        } catch (e) {}
                    } else {
                        const sent = await bot.sendMessage(chatId, `${getUserLink(msg.from)}, links aren't allowed here. Warning ${group.warns[key]}/${MAX_WARNS}.`, { parse_mode: 'Markdown' });
                        setTimeout(() => {
                            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                        }, 10000);
                        sendLog(chatId, `Link removed from ${getUserLink(msg.from)} (warn ${group.warns[key]}/${MAX_WARNS})`);
                    }
                    return;
                }
            }
        }

        // ─── GAME HANDLING ───
        if (msg.text && !msg.text.startsWith('/') && !msg.text.startsWith('!')) {
            if (group.gameState && group.gameState.active) {
                const gameType = group.gameState.type;
                if (gameType === 'wordchain') {
                    const handled = await processWordChain(msg, group, chatId);
                    if (handled) return;
                }
                if (gameType === 'trivia') {
                    const handled = await processTrivia(msg, group, chatId);
                    if (handled) return;
                }
                if (gameType === 'guessnumber') {
                    const handled = processGuessNumber(msg, group, chatId);
                    if (handled) return;
                }
                if (gameType === 'emoji') {
                    const handled = processEmojiRiddle(msg, group, chatId);
                    if (handled) return;
                }
                if (gameType === 'hangman') {
                    const handled = processHangman(msg, group, chatId);
                    if (handled) return;
                }
                if (gameType === 'math') {
                    const handled = processFastMath(msg, group, chatId);
                    if (handled) return;
                }
            }
        }

        // ─── FILTERS ───
        if (msg.text && !msg.text.startsWith('/') && !msg.text.startsWith('!')) {
            const lower = msg.text.toLowerCase().trim();
            if (group.filters[lower]) {
                const sent = await bot.sendMessage(chatId, group.filters[lower]);
                setTimeout(() => {
                    bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                }, 30000);
                return;
            }
        }

        // ─── NOTES ───
        if (msg.text && msg.text.startsWith('#')) {
            const noteName = msg.text.slice(1).trim().toLowerCase().split(/\s+/)[0];
            const note = group.notes[noteName];
            if (note) {
                try {
                    switch (note.type) {
                        case 'photo':
                            await bot.sendPhoto(chatId, note.fileId, { caption: note.caption || '', reply_to_message_id: msg.message_id });
                            break;
                        case 'video':
                            await bot.sendVideo(chatId, note.fileId, { caption: note.caption || '', reply_to_message_id: msg.message_id });
                            break;
                        case 'document':
                            await bot.sendDocument(chatId, note.fileId, { caption: note.caption || '', reply_to_message_id: msg.message_id });
                            break;
                        case 'animation':
                            await bot.sendAnimation(chatId, note.fileId, { caption: note.caption || '', reply_to_message_id: msg.message_id });
                            break;
                        case 'sticker':
                            await bot.sendSticker(chatId, note.fileId, { reply_to_message_id: msg.message_id });
                            break;
                        case 'voice':
                            await bot.sendVoice(chatId, note.fileId, { caption: note.caption || '', reply_to_message_id: msg.message_id });
                            break;
                        case 'audio':
                            await bot.sendAudio(chatId, note.fileId, { caption: note.caption || '', reply_to_message_id: msg.message_id });
                            break;
                        default:
                            await bot.sendMessage(chatId, note.text, { reply_to_message_id: msg.message_id });
                    }
                } catch (e) {}
                return;
            }
        }

        // ─── AUTO-TRANSLATE ───
        const targetLang = group.translateTo;
        if (targetLang && msg.text && !msg.text.startsWith('/') && !msg.text.startsWith('!')) {
            translateText(msg.text, targetLang).then(translated => {
                if (translated && translated.toLowerCase() !== msg.text.toLowerCase()) {
                    const sent = bot.sendMessage(chatId, `🌐 ${translated}`, {
                        parse_mode: 'Markdown',
                        reply_to_message_id: msg.message_id
                    }).catch(() => {});
                    if (sent) {
                        setTimeout(() => {
                            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                        }, 30000);
                    }
                }
            }).catch(() => {});
        }
    }

    // ─── PRIVATE CHAT SMART RESPONSES ───
    if (msg.chat.type === 'private' && msg.text && !msg.text.startsWith('/')) {
        trackDMUser(msg.from.id);
        
        if (pendingWelcomeSetup[chatId] || pendingCaptchaSetup[chatId] || 
            pendingSetWelcomeSetup[chatId] || pendingSetGoodbyeSetup[chatId] ||
            pendingBroadcastSetup[chatId]) {
            return;
        }
        
        const smartResponse = getSmartResponse(msg.text);
        if (smartResponse) {
            const sent = await bot.sendMessage(chatId, smartResponse, { parse_mode: 'Markdown' });
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            }, 30000);
        }
    }
});

// ============================================================
// 🛑 ERROR HANDLING ───
// ============================================================

bot.on('polling_error', (error) => {
    console.error('Polling error:', error.code || '', error.message || error);
});

bot.on('webhook_error', (error) => {
    console.error('Webhook error:', error.code || '', error.message || error);
});

process.on('unhandledRejection', (reason) => {
    const msg = (reason && reason.message) ? reason.message : String(reason);
    console.error('Unhandled rejection:', msg);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err && err.message ? err.message : err);
    saveDB();
    process.exit(1);
});

process.on('SIGINT', async () => {
    console.log('\n🛑 Bot stopped.');
    if (jobWorkerTimer) clearInterval(jobWorkerTimer);
    await premiumStore.close();
    saveDB();
    await bot.setWebHook('').catch(() => {});
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Bot terminated.');
    if (jobWorkerTimer) clearInterval(jobWorkerTimer);
    await premiumStore.close();
    saveDB();
    await bot.setWebHook('').catch(() => {});
    process.exit(0);
});

// ============================================================
// 🚀 START WEBHOOK SERVER ───
// ============================================================

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'webhook_sret_chgghgange_me_codyin_env';
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || `https://boot.pxxl.run/webhook/${WEBHOOK_SECRET}`;

const app = express();
app.use(express.json({ limit: '1mb' }));

function parseCookies(req) {
    return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => {
        const [key, ...value] = part.trim().split('=');
        return [key, decodeURIComponent(value.join('='))];
    }));
}

async function dashboardSession(req) {
    const raw = parseCookies(req).codye_session;
    if (!raw) return null;
    const [id, signature] = raw.split('.');
    const secret = process.env.DASHBOARD_SESSION_SECRET || WEBHOOK_SECRET;
    if (!id || !signature || !premiumStore.safeEqual(signature, premiumStore.signSession(id, secret))) return null;
    const session = await premiumStore.getSession(id);
    if (!session) return null;
    const access = await premiumStore.roleFor(Number(session.telegram_id), BOT_OWNER_IDS);
    return access ? { ...session, ...access } : null;
}

async function requireDashboard(req, res, next) {
    try {
        const session = await dashboardSession(req);
        if (!session) return res.status(401).json({ error: 'Sign in with an authorized Telegram account.' });
        if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-csrf-token'] !== session.csrf_token) return res.status(403).json({ error: 'Security token expired. Refresh and try again.' });
        req.dashboardSession = session;
        next();
    } catch (error) { res.status(503).json({ error: 'Dashboard storage is unavailable.' }); }
}

function requirePermission(permission) {
    return (req, res, next) => {
        if (!req.dashboardSession.permissions.includes('*') && !req.dashboardSession.permissions.includes(permission)) return res.status(403).json({ error: 'Your role does not allow this action.' });
        next();
    };
}

app.get('/api/public-config', (req, res) => res.json({ botUsername: BOT_USERNAME || EBOT_USERNAME.replace(/^@/, '') }));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/auth/telegram', async (req, res) => {
    try {
        const { hash, ...payload } = req.query;
        const authDate = Number(payload.auth_date);
        if (!hash || !authDate || Date.now() / 1000 - authDate > 300) return res.status(401).send('Expired Telegram login.');
        const check = Object.keys(payload).sort().map(key => `${key}=${payload[key]}`).join('\n');
        const key = crypto.createHash('sha256').update(token).digest();
        const expected = crypto.createHmac('sha256', key).update(check).digest('hex');
        if (!premiumStore.safeEqual(hash, expected)) return res.status(403).send('Telegram verification failed.');
        const access = await premiumStore.roleFor(Number(payload.id), BOT_OWNER_IDS);
        if (!access) return res.status(403).send('This Telegram account has not been assigned a dashboard role.');
        const session = await premiumStore.createSession(Number(payload.id));
        const secret = process.env.DASHBOARD_SESSION_SECRET || WEBHOOK_SECRET;
        const cookie = `${session.id}.${premiumStore.signSession(session.id, secret)}`;
        res.setHeader('Set-Cookie', `codye_session=${encodeURIComponent(cookie)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`);
        await premiumStore.audit(Number(payload.id), 'session.login', 'dashboard', 'web');
        res.redirect('/');
    } catch (error) {
        console.error('Dashboard session creation failed:', error.message);
        res.status(503).send(`Dashboard session storage failed using the ${premiumStore.backend()} backend. Check that the host allows persistent file writes and inspect the deployment logs.`);
    }
});
app.get('/', async (req, res) => {
    try { if (!(await dashboardSession(req))) return res.redirect('/login'); } catch (error) { return res.redirect('/login'); }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '1h' }));
app.get('/api/me', requireDashboard, (req, res) => res.json({ telegramId: req.dashboardSession.telegram_id, role: req.dashboardSession.role, permissions: req.dashboardSession.permissions, csrfToken: req.dashboardSession.csrf_token }));
app.post('/api/logout', requireDashboard, async (req, res) => {
    await premiumStore.deleteSession(req.dashboardSession.id);
    res.setHeader('Set-Cookie', 'codye_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
    res.json({ ok: true });
});
app.get('/api/overview', requireDashboard, async (req, res) => res.json(await premiumStore.overview()));
for (const resource of ['users', 'groups', 'campaigns', 'moderation', 'audits']) {
    app.get(`/api/${resource}`, requireDashboard, async (req, res) => {
        try { res.json(await premiumStore.list(resource, Number(req.query.limit) || 50)); }
        catch (error) { res.status(500).json({ error: error.message }); }
    });
}
app.get('/api/users/:id', requireDashboard, async (req, res) => {
    const record = await premiumStore.userDetail(Number(req.params.id));
    if (!record) return res.status(404).json({ error: 'User not found.' });
    res.json(record);
});
app.patch('/api/groups/:id', requireDashboard, requirePermission('groups:write'), async (req, res) => {
    try { res.json(await premiumStore.updateGroup(Number(req.params.id), req.body || {}, Number(req.dashboardSession.telegram_id))); }
    catch (error) { res.status(400).json({ error: error.message }); }
});
app.get('/api/roles', requireDashboard, requirePermission('roles:write'), async (req, res) => res.json(await premiumStore.roles()));
app.post('/api/roles', requireDashboard, requirePermission('roles:write'), async (req, res) => {
    try { res.status(201).json(await premiumStore.grantRole(req.body || {}, Number(req.dashboardSession.telegram_id))); }
    catch (error) { res.status(400).json({ error: error.message }); }
});
app.delete('/api/roles/:id', requireDashboard, requirePermission('roles:write'), async (req, res) => res.json({ revoked: Boolean(await premiumStore.revokeRole(req.params.id, Number(req.dashboardSession.telegram_id))) }));
app.get('/api/templates', requireDashboard, async (req, res) => res.json(await premiumStore.templates()));
app.post('/api/templates', requireDashboard, requirePermission('campaigns:write'), async (req, res) => {
    if (!req.body?.name || !req.body?.document?.text) return res.status(400).json({ error: 'Template name and text are required.' });
    res.status(201).json(await premiumStore.saveTemplate(req.body, Number(req.dashboardSession.telegram_id)));
});
app.get('/api/campaigns/:id/analytics', requireDashboard, requirePermission('analytics:read'), async (req, res) => res.json(await premiumStore.campaignAnalytics(req.params.id)));
app.post('/api/campaigns', requireDashboard, requirePermission('campaigns:write'), async (req, res) => {
    try {
        if (!req.body?.name || !req.body?.document?.text) return res.status(400).json({ error: 'Name and message are required.' });
        const buttons = req.body.document.buttons || [];
        if (buttons.length > 8 || buttons.some(button => !button.text || !/^https?:\/\//.test(button.url || ''))) return res.status(400).json({ error: 'Use up to 8 buttons with valid HTTP(S) URLs.' });
        const id = await premiumStore.createCampaign(req.body, Number(req.dashboardSession.telegram_id));
        if (req.body.schedule?.runAt) await premiumStore.scheduleJob('campaign.send', { campaignId: id }, new Date(req.body.schedule.runAt));
        res.status(201).json({ id });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

const JOB_WORKER_ID = `${process.pid}-${Date.now()}`;

async function runCampaignJob(job) {
    const campaign = await premiumStore.campaign(job.payload.campaignId);
    if (!campaign) throw new Error('Campaign not found');
    const audience = campaign.audience || {};
    const setup = campaign.document || {};
    const groupTargets = Object.keys(db).filter(id => Number(id) < 0);
    const dmTargets = Array.from(dmUsers).map(String);
    let targets = [...new Set([...groupTargets, ...dmTargets])];
    if (audience.type === 'groups') targets = groupTargets;
    if (audience.type === 'dms') targets = dmTargets;
    let sent = 0;
    let failed = 0;
    await premiumStore.createDeliveries(campaign.id, targets.map(id => ({ telegramId: Number(id), chatId: Number(id) < 0 ? Number(id) : null })));
    await premiumStore.campaignResult(campaign.id, 'sending', { targets: targets.length });
    for (const id of targets) {
        try {
            const delivered = await sendBroadcastTo(id, setup);
            sent += 1;
            await premiumStore.deliveryResult(campaign.id, Number(id), 'sent', { messageId: delivered?.message_id });
        } catch (error) {
            failed += 1;
            await premiumStore.deliveryResult(campaign.id, Number(id), 'failed', { error: error.message });
        }
        await new Promise(resolve => setTimeout(resolve, 75));
    }
    await premiumStore.campaignResult(campaign.id, failed === targets.length && targets.length ? 'failed' : 'completed', { targets: targets.length, sent, failed });
}

async function processDurableJobs() {
    try {
        const jobs = await premiumStore.claimJobs(JOB_WORKER_ID, 5);
        for (const job of jobs) {
            try {
                if (job.type === 'campaign.send') await runCampaignJob(job);
                else throw new Error(`Unsupported job type: ${job.type}`);
                await premiumStore.finishJob(job.id);
            } catch (error) { await premiumStore.finishJob(job.id, error.message); }
        }
    } catch (error) {
        if (premiumStore.available()) console.error('Job worker error:', error.message);
    }
}

// Webhook endpoint — Telegram POSTs here
app.post(`/webhook/${WEBHOOK_SECRET}`, (req, res) => {
    res.sendStatus(200);
    try {
        bot.processUpdate(req.body);
    } catch (err) {
        console.error('Error processing update:', err.message);
    }
});

// Health check for Pxxl/uptime monitoring
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), storage: premiumStore.backend() });
});

async function startWebhookServer() {
    return new Promise((resolve, reject) => {
        const server = app.listen(PORT, async () => {
            console.log(`${E.sparkle} Webhook server listening on port ${PORT}`);
            
            try {
                // Fetch bot info
                const me = await bot.getMe();
                BOT_ID = me.id;
                BOT_USERNAME = me.username;
                await validatePublicPremiumEmojis();
                console.log(`🆔 Bot ID: ${BOT_ID} (@${BOT_USERNAME})`);

                // Clear any existing webhook first (avoid 409 conflicts)
                console.log(`🧹 Clearing old webhook...`);
                await bot.deleteWebHook();
                
                // Wait a moment for Telegram to process the deletion
                await new Promise(resolve => setTimeout(resolve, 500));

                // Register new webhook with Telegram
                console.log(`🔗 Registering webhook: ${WEBHOOK_URL}`);
                await bot.setWebHook(WEBHOOK_URL);
                console.log(`✅ Webhook registered successfully`);

                // Restore lock timers from DB
                for (const [chatId, group] of Object.entries(db)) {
                    if (group.lock && group.lock.active && group.lock.until) {
                        const remaining = group.lock.until - Date.now();
                        if (remaining > 0) {
                            lockTimers[chatId] = setTimeout(async () => {
                                await setGroupLock(chatId, false);
                                group.lock = { active: false, until: null };
                                saveDB();
                                const sent = await bot.sendMessage(chatId, `Group automatically unlocked. Everyone can chat again.`).catch(() => {});
                                if (sent) {
                                    setTimeout(() => {
                                        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                                    }, 5000);
                                }
                            }, remaining);
                        } else {
                            await setGroupLock(chatId, false);
                            group.lock = { active: false, until: null };
                            saveDB();
                        }
                    }
                }

                await processDurableJobs();
                jobWorkerTimer = setInterval(processDurableJobs, 15000);
                console.log(`${E.sparkle} Bot is running and waiting for webhook updates.`);
                resolve(server);
            } catch (err) {
                console.error('Failed to initialize webhook:', err.message);
                server.close();
                reject(err);
            }
        });

        server.on('error', reject);
    });
}

// Start webhook server after acquiring single-instance lock
acquireSingleInstanceLock().then(() => startWebhookServer()).catch((err) => {
    console.error('Failed to start webhook server:', err.message);
    process.exit(1);
});
