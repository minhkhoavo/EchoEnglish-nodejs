# EchoEnglish Node.js  

EchoEnglish là backend service được xây dựng bằng **Node.js + Express + TypeScript + MongoDB** để quản lý hệ thống học tiếng Anh.  

---

## Danh sách thành viên thực hiện
- Lê Đình Lộc - 22110369
- Võ Minh Khoa - 22110355
- Võ Văn Trí - 22110444
- Nguyễn Hoàng Anh Khoa - 22110352

---

## 🚀 Yêu cầu hệ thống  

- **Node.js** >= 18  
- **npm** >= 9 hoặc **yarn**  
- **MongoDB** >= 6  

---

## 📂 Cấu trúc thư mục  

```bash
echoenglish-nodejs/
├── src/                # Source code TypeScript
│   ├── index.ts        # Entry point
│   ├── config/         # Cấu hình database và third-party
│   ├── controllers/    # Xử lý request/response
│   ├── dto/           # Data Transfer Objects
│   ├── enum/          # Định nghĩa enum
│   ├── middlewares/   # Xử lý trung gian
│   ├── services/       # Business logic
│   ├── routes/         # Định tuyến API
│   ├── models/         # Mongoose models
│   └── utils/          # Helper functions
├── dist/               # Compiled JavaScript code
├── .env                # Environment variables
├── nodemon.json        # Nodemon configuration
├── package.json
└── tsconfig.json

```

---
## ⚙️ Cầu hình file .env
- Tạo file .env ở thư mục gốc và cấu hình như sau:
## Sửa cấu hình SMTP để gửi email
#### Tham số cấu hình mail
- SMTP_HOST=smtp.gmail.com
- SMTP_PORT=587
- SMTP_USER=your_email@gmail.com
- SMTP_PASS=your_email_password
- FROM_EMAIL=your_email@gmail.com
#### Tham số JWT token
- JWT_SECRETKEY=your_jwt_token
#### Tham số cấu hình VNPay
- VNP_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html
- VNP_TMNCODE=your_tmn_code
- VNP_HASH_SECRET=your_hash_secret
- VNP_RETURN_URL=http://localhost:8099/payments/vnpay/return

## 📦 Cài đặt
```bash
git clone https://github.com/minhkhoavo/EchoEnglish-nodejs.git
cd EchoEnglish-nodejs
npm install
```

## ▶️ Chạy dự án
## Development (hot reload với Nodemon + TSX)
```bash
npm run dev
```
or
```bash
pnpm dev
```

## Build TypeScript sang JavaScript
```bash
npm run build
```
or
```bash
pnpm build
```

## Run sau khi build
```bash
npm run start
```
or
```bash
pnpm start
```