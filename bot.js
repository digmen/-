import 'dotenv/config'
import { Telegraf } from 'telegraf'
import { prisma } from './db.js'
import OpenAI from 'openai'

const bot = new Telegraf(process.env.BOT_TOKEN)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

bot.start(async (ctx) => {
    const user = ctx.from
    try {
        await prisma.user.upsert({
            where: { telegramId: user.id.toString() },
            update: {},
            create: {
                telegramId: user.id.toString(),
                firstName: user.first_name,
                username: user.username,
            },
        })

        await ctx.reply(`Привет, ${user.first_name || 'друг'}! 👋 Я — твой психолог. Расскажи, что тебя беспокоит.`)
    } catch (err) {
        console.error('Ошибка:', err)
        await ctx.reply('Произошла ошибка. Попробуйте позже.')
    }
})

bot.on('text', async (ctx) => {
    const user = ctx.from
    const userId = user.id.toString()
    const messageText = ctx.message.text

    // 1. Убедимся, что пользователь есть в базе
    const dbUser = await prisma.user.upsert({
        where: { telegramId: userId },
        update: {},
        create: {
            telegramId: userId,
            firstName: user.first_name,
            username: user.username,
        },
    })

    // 2. Сохраним сообщение пользователя
    await prisma.message.create({
        data: {
            userId: dbUser.id,
            content: messageText,
            fromBot: false,
        },
    })

    // 3. Получим последние 10 сообщений (контекст)
    const history = await prisma.message.findMany({
        where: { userId: dbUser.id },
        orderBy: { createdAt: 'asc' },
        take: 10,
    })

    const chatMessages = history.map((msg) => ({
        role: msg.fromBot ? 'assistant' : 'user',
        content: msg.content,
    }))

    chatMessages.push({
        role: 'user',
        content: messageText,
    })

    // 4. Отправим в ChatGPT
    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                {
                    role: 'system',
                    content: 'Ты — доброжелательный психолог. Помогай, сочувствуй, поддерживай. Не давай диагнозов.',
                },
                ...chatMessages,
            ],
        })

        const reply = completion.choices[0].message.content

        // 5. Сохраним ответ бота
        await prisma.message.create({
            data: {
                userId: dbUser.id,
                content: reply,
                fromBot: true,
            },
        })

        // 6. Отправим пользователю
        await ctx.reply(reply)
    } catch (err) {
        console.error('GPT Ошибка:', err)
        await ctx.reply('Сейчас не могу ответить 😢 Попробуй позже.')
    }
})

bot.launch()
console.log('🤖 Психолог-бот запущен')
