# 🎓 EchoEnglish - AI-Powered English Learning Platform

> A comprehensive backend service for intelligent English language learning with AI-driven features, real-time feedback, and personalized learning paths.

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-13AA52?style=flat-square&logo=mongodb&logoColor=white)
![License](https://img.shields.io/badge/License-ISC-blue?style=flat-square)

[Features](#-features) • [Quick Start](#-quick-start) • [Tech Stack](#-tech-stack) • • [Contact](#-contact)

</div>

---

## ✨ Features

- **🤖 AI-Powered Chatbot** - Real-time English learning assistant with intelligent responses
- **🎤 Speech Recognition & Analysis** - Pronunciation assessment and speaking proficiency evaluation
- **✍️ Writing Evaluation** - AI-driven writing assessment with detailed feedback
- **📚 Adaptive Learning Paths** - Personalized study plans based on user proficiency
- **🔤 Flashcard System** - Interactive flashcard management with spaced repetition
- **🎯 Competency Profiling** - Real-time skill tracking and progress monitoring
- **📊 Smart Dashboard** - Comprehensive learning analytics and performance insights
- **💳 Payment Integration** - VNPay & Stripe for premium features
- **📧 Email Notifications** - Real-time alerts and learning reminders
- **🌍 RSS Feed Integration** - Curated English content aggregation
- **🔐 JWT Authentication** - Secure user authentication and authorization
- **⚡ Real-time Communication** - WebSocket support for instant notifications

---

## � Screenshots

**Dashboard**
<p align="center">
  <img src="docs/dashboard_overview.png" width="320" alt="dashboard_overview" />
  <img src="docs/dashboard_roadmap.png" width="320" alt="dashboard_roadmap" />
  <img src="docs/dashboard_today.png" width="320" alt="dashboard_today" />
</p>
<p align="center">
  <img src="docs/dashboard_today_personalGuide.PNG" width="320" alt="dashboard_today_personalGuide" />
  <img src="docs/dashboard_today_vocabularySet.PNG" width="320" alt="dashboard_today_vocabularySet" />
</p>

**Learning Route**
<p align="center">
  <img src="docs/lranalyze_overview.png" width="320" alt="lranalyze_overview" />
  <img src="docs/lr_diagnosis.png" width="320" alt="lr_diagnosis" />
  <img src="docs/lr_partAnalyze.png" width="320" alt="lr_partAnalyze" />
  <img src="docs/lr_studyplan.png" width="320" alt="lr_studyplan" />
  <img src="docs/lr_time.png" width="320" alt="lr_time" />
</p>

**Speech Analyzer**
<p align="center">
  <img src="docs/speech_analyzer_vocabulary.png" width="320" alt="speech_analyzer_vocabulary" />
  <img src="docs/speech_analyzer_pronunciation.png" width="320" alt="speech_analyzer_pronunciation" />
  <img src="docs/speech_analyzer_intonation.png" width="320" alt="speech_analyzer_intonation" />
  <img src="docs/speech_analyzer_fluency.png" width="320" alt="speech_analyzer_fluency" />
  <img src="docs/speech_analyzer_list.png" width="320" alt="speech_analyzer_list" />
</p>

**Resources & Flashcard**
<p align="center">
  <img src="docs/resources_list.png" width="320" alt="resources_list" />
  <img src="docs/resource_article.PNG" width="320" alt="resource_article" />
  <img src="docs/resource_video.png" width="320" alt="resource_video" />
  <img src="docs/flashcard.PNG" width="320" alt="flashcard" />
</p>

**Tests**
<p align="center">
  <img src="docs/tests_list.png" width="320" alt="tests_list" />
  <img src="docs/tests_lr_answer.PNG" width="320" alt="tests_lr_answer" />
  <img src="docs/tests_result.PNG" width="320" alt="tests_result" />
  <img src="docs/test_lr.PNG" width="320" alt="test_lr" />
</p>

---

## �🚀 Quick Start

### Prerequisites

```
Node.js ≥ 18
MongoDB ≥ 6
npm ≥ 9 or pnpm
```

### Installation

```bash
# Clone the repository
git clone https://github.com/minhkhoavo/EchoEnglish-nodejs.git
cd EchoEnglish-nodejs

# Install dependencies
pnpm install
```

### Environment Setup

Copy the `.env.example` file to `.env` and fill in your configuration values:

```bash
cp .env.example .env
```

### Development

```bash
pnpm dev
```

### Production

```bash
pnpm prod
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js |
| **Language** | TypeScript |
| **Framework** | Express.js |
| **Database** | MongoDB + Mongoose |
| **Real-time** | Socket.io |
| **Authentication** | JWT + bcrypt |
| **Storage** | AWS S3 |
| **Payments** | Stripe, VNPay |
| **Code Quality** | ESLint, Prettier, Husky |

---

## 🐳 Docker Support

```bash
# Build Docker image
docker build -t echoenglish-api .

# Run with docker-compose
docker-compose up -d
```

---


## 🤝 Contributors

| Name | ID |
|------|-----|
| Võ Minh Khoa | 22110355 |
| Nguyễn Hoàng Anh Khoa | 22110352 |
| Lê Đình Lộc | 22110369 |
| Võ Văn Trí | 22110444 |

---

---

## 📧 Contact

For inquiries, support, or collaboration:

- **GitHub**: [@minhkhoavo](https://github.com/minhkhoavo)
- **Email**: v.minhkhoa123456@gmail.com
- **Issues**: [GitHub Issues](https://github.com/minhkhoavo/EchoEnglish-nodejs/issues)
- **Discussions**: [GitHub Discussions](https://github.com/minhkhoavo/EchoEnglish-nodejs/discussions)

---

<div align="center">

**[⬆ Back to Top](#-echenglish---ai-powered-english-learning-platform)**

Made with ❤️ by the EchoEnglish Team

</div>
