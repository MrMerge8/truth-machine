import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Check for API key
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
let openai = null;

if (OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  console.log('✅ OpenAI API key configured');
} else {
  console.log('⚠️  No OPENAI_API_KEY found - API will not work until key is provided');
}

// Configure multer for temporary file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `audio_${Date.now()}.webm`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

app.use(express.json());
app.use(express.static('public'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Lie Detector is ready!' });
});

// Main analysis endpoint
app.post('/api/analyze', upload.single('audio'), async (req, res) => {
  let audioPath = null;
  
  try {
    if (!openai) {
      return res.status(500).json({ 
        error: 'API not configured', 
        message: 'OpenAI API key is not set. Please set OPENAI_API_KEY environment variable.' 
      });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }
    
    audioPath = req.file.path;
    const mode = req.body.mode || 'free';
    const prompt = req.body.prompt || null;
    
    console.log(`🎤 Received audio for analysis (mode: ${mode})`);
    
    // Step 1: Transcribe with Whisper
    console.log('📝 Transcribing audio...');
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
      response_format: 'verbose_json'
    });
    
    const transcript = transcription.text;
    const duration = transcription.duration || 0;
    
    console.log(`📝 Transcript: "${transcript}"`);
    
    // Step 2: Analyze with GPT-4
    console.log('🔍 Analyzing for deception...');
    
    const analysisPrompt = buildAnalysisPrompt(transcript, duration, mode, prompt);
    
    const analysis = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are "THE TRUTH MACHINE" - a dramatic, entertaining AI lie detector for a party game. 
Your job is to analyze statements and deliver verdicts with theatrical flair.

You analyze linguistic patterns that MIGHT indicate deception (for entertainment purposes):
- Hedging language ("I think", "maybe", "probably")
- Distancing language (avoiding "I", using passive voice)
- Over-explanation or excessive detail
- Lack of sensory details in stories
- Qualifying statements excessively
- Unusual pause patterns or filler words
- Inconsistencies or vague timelines
- Overly smooth, rehearsed-sounding responses

Remember: This is a PARTY GAME. Be dramatic, fun, and entertaining! Use emojis sparingly but effectively.
Your verdicts should feel like a game show reveal.`
        },
        {
          role: 'user',
          content: analysisPrompt
        }
      ],
      temperature: 0.8,
      max_tokens: 1000
    });
    
    const result = analysis.choices[0].message.content;
    
    // Parse the structured response
    const parsedResult = parseAnalysisResult(result, mode);
    
    console.log(`✅ Verdict: ${parsedResult.verdict} (${parsedResult.confidence}% confidence)`);
    if (parsedResult.scores) {
      console.log(`📊 Scores:`, parsedResult.scores);
    }
    
    // IMMEDIATELY delete the audio file
    deleteAudioFile(audioPath);
    audioPath = null;
    
    res.json({
      success: true,
      transcript,
      duration,
      ...parsedResult
    });
    
  } catch (error) {
    console.error('Analysis error:', error);
    
    // Ensure cleanup on error
    if (audioPath) {
      deleteAudioFile(audioPath);
    }
    
    res.status(500).json({ 
      error: 'Analysis failed', 
      message: error.message 
    });
  }
});

// Get a random challenge prompt
app.get('/api/challenge', (req, res) => {
  const challenges = [
    {
      type: 'two_truths',
      title: '🎭 Two Truths & A Lie',
      instruction: 'Tell us THREE things about yourself. Two must be TRUE, one must be a LIE. We\'ll guess which is the lie!',
      followUp: 'Which statement was the lie?'
    },
    {
      type: 'yes_no',
      title: '❓ Yes or No',
      question: getRandomYesNoQuestion(),
      instruction: 'Answer this question honestly... or not! We\'ll detect if you\'re lying.'
    },
    {
      type: 'story',
      title: '📖 Story Time',
      instruction: 'Tell us a short story about something that happened to you. It can be TRUE or completely MADE UP!',
    },
    {
      type: 'confession',
      title: '🤫 Confession Booth',
      instruction: 'Confess something! It can be a real confession or a fake one. We\'ll judge your sincerity!',
    },
    {
      type: 'alibi',
      title: '🕵️ The Alibi',
      question: getRandomAlibiQuestion(),
      instruction: 'Answer this question. Give us your alibi - truth or lies, your choice!'
    },
    {
      type: 'never_have_i',
      title: '🙅 Never Have I Ever',
      question: getRandomNeverHaveI(),
      instruction: 'Have you done this? Answer truthfully... or bluff!'
    }
  ];
  
  const challenge = challenges[Math.floor(Math.random() * challenges.length)];
  res.json(challenge);
});

function getRandomYesNoQuestion() {
  const questions = [
    "Have you ever pretended to be sick to skip work or school?",
    "Have you ever snooped through someone's phone?",
    "Have you ever lied about your age?",
    "Have you ever taken credit for someone else's work?",
    "Have you ever pretended to like a gift you actually hated?",
    "Have you ever eavesdropped on a private conversation?",
    "Have you ever blamed a fart on someone else?",
    "Have you ever lied on your resume?",
    "Have you ever secretly read someone's diary or messages?",
    "Have you ever returned an item after using it?"
  ];
  return questions[Math.floor(Math.random() * questions.length)];
}

function getRandomAlibiQuestion() {
  const questions = [
    "Where were you last Saturday night at 10pm?",
    "What did you have for breakfast three days ago?",
    "Who was the last person you texted and what about?",
    "What were you doing exactly one week ago right now?",
    "Where were you when you heard the news about [that thing]?"
  ];
  return questions[Math.floor(Math.random() * questions.length)];
}

function getRandomNeverHaveI() {
  const statements = [
    "Have you ever ghosted someone?",
    "Have you ever lied to get out of plans?",
    "Have you ever pretended to know a song everyone else knew?",
    "Have you ever stolen something (even small)?",
    "Have you ever had a secret social media account?",
    "Have you ever blamed autocorrect for a message you meant to send?",
    "Have you ever pretended to be on a phone call to avoid someone?",
    "Have you ever re-gifted a present?"
  ];
  return statements[Math.floor(Math.random() * statements.length)];
}

function buildAnalysisPrompt(transcript, duration, mode, prompt) {
  const wordsPerSecond = transcript.split(' ').length / (duration || 1);
  const wordCount = transcript.split(' ').length;
  
  let contextInfo = '';
  if (prompt) {
    contextInfo = `\n\nCONTEXT: They were responding to this challenge: "${prompt}"`;
  }
  
  // Use enhanced scoring for party mode
  if (mode === 'party') {
    return `You are THE TRUTH MACHINE - a dramatic game show host judging lies at a party!

🎯 THE CHALLENGE: "${prompt}"

🎤 THE PLAYER'S LIE: "${transcript}"

📊 SPEECH DATA:
- Duration: ${duration?.toFixed(1) || 'unknown'} seconds
- Words: ${wordCount}
- Pace: ${wordsPerSecond.toFixed(1)} words/sec

SCORE THIS LIE on 5 criteria. Use PRECISE decimals (7.3, 8.7, 6.1 etc.) - NEVER round numbers!

Return ONLY this JSON (no markdown, no explanation before/after):
{
  "verdict": "TRUTH" or "DECEPTION",
  "confidence": [50-99, how sure you are],
  "scores": {
    "deception": [0.0-10.0 - POKER FACE: Did they sell it? Voice steady? No nervous tells?],
    "conviction": [0.0-10.0 - CONFIDENCE: Did they sound like they believed their own lie?],
    "creativity": [0.0-10.0 - IMAGINATION: Was this a creative, original story or basic?],
    "detail": [0.0-10.0 - WORLD-BUILDING: Rich details, names, specifics? Or vague?],
    "entertainment": [0.0-10.0 - SHOWMANSHIP: Was it funny, dramatic, or entertaining?]
  },
  "totalScore": [sum of all 5 scores],
  "breakdown": "[2-3 sentence performance review - be specific about what they did]",
  "signals": "[What linguistic/vocal patterns gave them away OR fooled you]",
  "judgment": "[DRAMATIC 1-2 sentence game show verdict with personality!]",
  "tip": "[One specific, actionable tip to become a better liar]"
}`;
  }
  
  // Standard analysis for non-party modes
  return `ANALYZE THIS STATEMENT FOR DECEPTION:

"${transcript}"

SPEECH METRICS:
- Duration: ${duration?.toFixed(1) || 'unknown'} seconds
- Approximate speaking pace: ${wordsPerSecond.toFixed(1)} words/second
- Mode: ${mode}${contextInfo}

Provide your analysis in this EXACT format:

VERDICT: [TRUTH or DECEPTION]
CONFIDENCE: [0-100]%

🎯 THE BREAKDOWN:
[2-3 sentences explaining what you detected in their speech patterns]

🔍 SUSPICIOUS SIGNALS:
[List 2-4 specific things you noticed, or "None detected" if clean]

💡 THE VERDICT EXPLAINED:
[1-2 entertaining sentences delivering your final judgment with dramatic flair]

Remember: Be entertaining! This is a party game. Ham it up!`;
}

function parseAnalysisResult(result, mode) {
  try {
    // Try to parse as JSON first (for party mode)
    if (mode === 'party') {
      try {
        // Clean up potential markdown code blocks
        let jsonStr = result.trim();
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        }
        
        const parsed = JSON.parse(jsonStr);
        return {
          verdict: parsed.verdict || 'UNKNOWN',
          confidence: parsed.confidence || 50,
          scores: parsed.scores || null,
          totalScore: parsed.totalScore || 0,
          breakdown: parsed.breakdown || '',
          signals: parsed.signals || '',
          explanation: parsed.judgment || '',
          tip: parsed.tip || '',
          raw: result
        };
      } catch (jsonErr) {
        console.log('JSON parse failed, falling back to text parsing');
      }
    }
    
    // Fallback to text parsing
    const verdictMatch = result.match(/VERDICT:\s*(TRUTH|DECEPTION)/i);
    const confidenceMatch = result.match(/CONFIDENCE:\s*(\d+)/);
    
    const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'UNKNOWN';
    const confidence = confidenceMatch ? parseInt(confidenceMatch[1]) : 50;
    
    // Extract sections
    const breakdownMatch = result.match(/🎯 THE BREAKDOWN:\s*([\s\S]*?)(?=🔍|$)/);
    const signalsMatch = result.match(/🔍 SUSPICIOUS SIGNALS:\s*([\s\S]*?)(?=💡|$)/);
    const explainedMatch = result.match(/💡 THE VERDICT EXPLAINED:\s*([\s\S]*?)$/);
    
    return {
      verdict,
      confidence,
      scores: null,
      totalScore: null,
      breakdown: breakdownMatch ? breakdownMatch[1].trim() : '',
      signals: signalsMatch ? signalsMatch[1].trim() : '',
      explanation: explainedMatch ? explainedMatch[1].trim() : '',
      tip: '',
      raw: result
    };
  } catch (e) {
    return {
      verdict: 'UNKNOWN',
      confidence: 50,
      scores: null,
      totalScore: null,
      breakdown: result,
      signals: '',
      explanation: '',
      tip: '',
      raw: result
    };
  }
}

function deleteAudioFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('🗑️ Audio file deleted immediately');
    }
  } catch (err) {
    console.error('Error deleting audio file:', err);
  }
}

// Cleanup uploads folder on startup
const uploadsDir = join(__dirname, 'uploads');
if (fs.existsSync(uploadsDir)) {
  const files = fs.readdirSync(uploadsDir);
  files.forEach(file => {
    fs.unlinkSync(join(uploadsDir, file));
  });
  console.log('🧹 Cleaned up old audio files');
}

app.listen(PORT, () => {
  console.log(`
🎭 ═══════════════════════════════════════════════════════
   THE TRUTH MACHINE - AI Lie Detector Party Game
   Running on http://localhost:${PORT}
═══════════════════════════════════════════════════════ 🎭
  `);
});

