# Expo App

Ứng dụng React Native dùng Expo để kết nối WebSocket tới server.

## Thiết lập

1. Sao chép file mẫu:
   ```bash
   cp .env.example .env
   ```
2. Chỉnh `WS_HOST` và `WS_PORT` theo máy chủ của bạn.
3. Khởi động Expo:
   ```bash
   npm start
   ```

## Biến môi trường

- `WS_HOST`: địa chỉ IP hoặc hostname của server WebSocket.
- `WS_PORT`: cổng server WebSocket.
