import express from 'express'
import cors from 'cors'
import fetch from 'node-fetch'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))

// Serve frontend build files
app.use(express.static(path.join(__dirname, 'dist')))

// Gemini API proxy
app.post('/api/messages', async (req, res) => {
  try {
    const { messages, system } = req.body
    const apiKey = process.env.GEMINI_API_KEY

    const userMessage = messages[0]
    const parts = []

    if (system) {
      parts.push({ text: system })
    }

    if (Array.isArray(userMessage.content)) {
      for (const block of userMessage.content) {
        if (block.type === 'text') {
          parts.push({ text: block.text })
        } else if (block.type === 'image' && block.source) {
          parts.push({
            inlineData: {
              mimeType: block.source.media_type,
              data: block.source.data
            }
          })
        } else if (block.type === 'document' && block.source) {
          parts.push({
            inlineData: {
              mimeType: 'application/pdf',
              data: block.source.data
            }
          })
        }
      }
    }

    const geminiBody = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4000,
      }
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody)
      }
    )

    const data = await response.json()

    if (data.error) {
      return res.status(400).json({ error: { message: data.error.message } })
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    res.json({
      content: [{ type: 'text', text }]
    })

  } catch (err) {
    console.error(err)
    res.status(500).json({ error: { message: err.message } })
  }
})

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
