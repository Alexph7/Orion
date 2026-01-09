import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';

dotenv.config();

/* =========================
   USUÁRIOS PERMITIDOS
========================= */
const ALLOWED_USERS = [
    6294708048,
    2132935211,
    6602664281
];

function isAllowed(ctx) {
    return ctx.from && ALLOWED_USERS.includes(ctx.from.id);
}

/* =========================
   STORES (PERSISTENTE)
========================= */
const STORES_FILE = './stores.json';
let STORES = {};

function loadStores() {
    if (!fs.existsSync(STORES_FILE)) {
        throw new Error('Arquivo stores.json não encontrado.');
    }
    STORES = JSON.parse(fs.readFileSync(STORES_FILE, 'utf-8'));
}

function saveStores() {
    fs.writeFileSync(STORES_FILE, JSON.stringify(STORES, null, 2), 'utf-8');
}

/* =========================
   BOT
========================= */
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const TG_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;

async function sendTelegramMessage(chatId, text) {
    await fetch(TG_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML'
        })
    });
}

/* =========================
   ESTADOS
========================= */
const waitingPostInput = new Set();
const waitingEditStore = new Map();
// userId -> 'SELECTING' | 'A' | 'M' | 'S' | 'MA'

/* =========================
   UTIL
========================= */
function normalizeInput(input) {
    return input.replace(/\s+/g, ' ').trim();
}

/* =========================
   /edit
========================= */
bot.command('edit', (ctx) => {
    if (!isAllowed(ctx)) return;

    waitingEditStore.set(ctx.from.id, 'SELECTING');

    ctx.reply(
        'Qual link deseja substituir?\n' +
        '1. Amazon\n' +
        '2. Mercado Livre\n' +
        '3. Shopee\n' +
        '4. Magalu'
    );
});

/* =========================
   PARSER POST
========================= */
function processPostInput(input) {
    const normalized = normalizeInput(input);
    const parts = normalized.split(' ');

    if (parts.length < 3) {
        return '❌ Formato inválido. Use: m15, 60 codigo';
    }

    const [firstPart, limitRaw, ...rest] = parts;
    const code = rest.join(' ').toUpperCase();

    const firstLower = firstPart.toLowerCase();

    const storeKey = firstLower.startsWith('ma')
        ? 'MA'
        : firstLower[0].toUpperCase();

    const store = STORES[storeKey];
    if (!store) return '❌ Loja inválida.';

    const valueRaw = firstLower.slice(storeKey.length);
    if (!valueRaw || isNaN(valueRaw.replace(',', ''))) {
        return '❌ Desconto inválido.';
    }

    const isPercentage = valueRaw.endsWith(',');
    const value = valueRaw.replace(',', '');

    const discountText = isPercentage
        ? `${value}% até R$${limitRaw}`
        : `R$${value} em R$${limitRaw}`;

    let linkBlock = '';

    if (storeKey === 'S') {
        linkBlock =
            `🔗 Carteira: ${store.link.wallet}\n` +
            `🔗 Carrinho: ${store.link.cart}`;
    } else if (storeKey === 'A') {
        linkBlock =
            `🔗 Resgate Aqui: ${store.link}\n\n` +
            `⭐️Assine o Prime, grátis por 30 dias:\n${store.prime}`;
    } else if (storeKey === 'M') {
        linkBlock = `🔗 Desconto link: ${store.link}`;
    } else if (storeKey === 'MA') {
        linkBlock = `🔗 Resgate Aqui: ${store.link}`;
    }

    return (
        `${store.name}\n\n` +
        `✅ ${discountText} 🔑 <code>${code}</code>\n` +
        `${linkBlock}`
    );
}

/* =========================
   /post
========================= */
bot.command('post', (ctx) => {
    if (!isAllowed(ctx)) return;
    waitingPostInput.add(ctx.from.id);
    ctx.reply('Envie os dados do cupom \nEx: m15, 60 EXEMPLOCOD.');
});

/* =========================
   /cancel
========================= */
bot.command('cancel', (ctx) => {
    if (!isAllowed(ctx)) return;
    waitingPostInput.delete(ctx.from.id);
    waitingEditStore.delete(ctx.from.id);
    ctx.reply('Operação cancelada.');
});

/* =========================
   TEXT HANDLER
========================= */
bot.on('text', async (ctx) => {
    if (!isAllowed(ctx)) return;

    const userId = ctx.from.id;
    const text = ctx.message.text.trim();

    /* -------- EDIT -------- */
    if (waitingEditStore.has(userId)) {
        const state = waitingEditStore.get(userId);

        if (state === 'SELECTING') {
            const map = { '1': 'A', '2': 'M', '3': 'S', '4': 'MA' };
            const key = map[text];

            if (!key) return ctx.reply('❌ Envie 1, 2, 3 ou 4.');

            waitingEditStore.set(userId, key);
            return ctx.reply('Envie o novo link.');
        }

        if (!text.startsWith('http')) {
            return ctx.reply('❌ Link inválido.');
        }

        if (state === 'S') {
            return ctx.reply('❌ Shopee exige edição manual (wallet/cart).');
        }

        STORES[state].link = text;
        saveStores();

        waitingEditStore.delete(userId);
        return ctx.reply('✅ Link atualizado.');
    }

    /* -------- POST -------- */
    if (!waitingPostInput.has(userId)) return;
    if (text.startsWith('/')) return;

    waitingPostInput.delete(userId);

    const message = processPostInput(text);
    if (message.startsWith('❌')) return ctx.reply(message);

    await sendTelegramMessage(process.env.TG_CHANNEL_ID, message);
    ctx.reply('Post enviado.');
});

/* =========================
   START
========================= */
loadStores();

bot.launch().then(() => {
    console.log('Bot rodando.');
});
