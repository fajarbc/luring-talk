# LuringTalk Call - P2P Offline Video Chat

**LuringTalk** is a Progressive Web App (PWA) designed for voice and video calling between two devices on the same local Wi-Fi network (Hotspot or Router). It uses WebRTC for peer-to-peer communication and requires **NO Internet connection**.

---

## 🚀 How to Access & Use

### Prerequisites
1.  **Two Devices**: Mobile phones, laptops, or tablets.
2.  **Local Network**: Both devices must be on the **same Wi-Fi** network.
    *   *Recommended*: Create a Wi-Fi Hotspot on Device A and connect Device B to it.
3.  **HTTPS**: The app must be served over HTTPS (even self-signed) for camera access.

### Step-by-Step Guide

#### 1. Start the Server (Device A)
Assuming you have built the app and started the server on Device A (your computer):

```bash
npm start
```

#### 2. Connect Devices
*   **Device A (Host)**: Open `https://localhost:8080`.
*   **Device B (Guest)**: Connect to Device A's Wi-Fi. Open `https://<DEVICE_A_IP>:8080`.
    *   *Note*: Find `<DEVICE_A_IP>` displayed on the LuringTalk Home Screen on Device A.
    *   *Security Warning*: You will see "Connection not private". Click **Advanced** -> **Proceed**.

#### 3. Establish Call
1.  **Device A**: Tap **START CALL**.
    *   A QR code (Offer) will appear.
2.  **Device B**: Tap **JOIN CALL**.
    *   Scan Device A's QR Code.
    *   After scanning, Device B generates its own QR Code (Answer).
3.  **Device A**: Tap **I Scanned Device B**.
    *   Scan Device B's QR Code.
4.  **Connected!** Video should appear instantly.

---

## 📱 Device & Browser Support

| Platform | Browser | Version | Notes |
| :--- | :--- | :--- | :--- |
| **Android** | Chrome | 88+ | Best performance. Install as PWA supported. |
| **iOS** | Safari | 14.3+ | Must use Safari. "Add to Home Screen" manual. |
| **Desktop** | Chrome/Edge | 88+ | Works flawlessly. |
| **Desktop** | Firefox | 85+ | Supported. |

**Hardware Requirements:**
*   Camera and Microphone.
*   Wi-Fi capability.

---

## 🛠️ Troubleshooting

### 1. "Connection Failed" or Black Screen
*   **Firewall**: Ensure the host (Device A) firewall is allowing traffic on port `8080`.
    *   *Windows*: Allow Node.js through Windows Defender Firewall.
    *   *Mac*: Check System Settings > Network > Firewall.
*   **Different Networks**: Double-check that Device B is connected to Device A's specific Wi-Fi Hotspot.
*   **IP Address**: Ensure you are typing the IP exactly as shown on the host screen.

### 2. QR Code Scanning Issues
*   **Lighting**: Ensure screen brightness is high on the device showing the code.
*   **Distance**: Move camera back/forth to focus.
*   **Manual Fallback**: If scanning fails, use the "Copy Code" button and paste the text (via a local notepad or messenger if available, though this app is designed for offline).

### 3. Camera Not Opening
*   **Permissions**: Reset browser permissions for the site and Allow Camera/Mic.
*   **HTTPS**: You **must** use `https://`. `http://` will block camera access on mobile.

---

## 📊 Performance Notes

*   **Connection Time**: Typically < 2 seconds after final scan.
*   **Latency**: Very low (< 100ms) due to local LAN routing.
*   **Codecs**: Uses VP8/Opus. 
*   **Packet Loss**: WebRTC handles minor packet loss, but weak Wi-Fi signal will freeze video. Ensure devices are within range of the hotspot.

## 💻 Local Development Setup

Development certificates are no longer committed. Generate your own local `key.pem` and `cert.pem` before starting the HTTPS server.

### 1. Install dependencies
```bash
npm install
```

### 2. Generate a local certificate
```bash
npm run cert
```

What the script does:
- creates a self-signed certificate for `localhost`, `127.0.0.1`, and the machine's current LAN IPv4 addresses
- writes `key.pem` and `cert.pem` at the repo root
- keeps those files local because `*.pem` is gitignored

If you prefer a locally trusted certificate, `mkcert` is a nicer option. Generate `key.pem` and `cert.pem` with it and place them in the repo root.

> `npm run cert` shells out to `openssl`. If `openssl` is not on your PATH (common on Windows), run it from Git Bash/WSL or use `mkcert` instead.

### 3. Build and start the app
```bash
npm run build
npm start
```

### Debug Mode (Jump Straight to Call UI)
Set `VITE_DEBUG_MODE=true` before running the app to skip setup and open the video call page directly.

Example:
```bash
VITE_DEBUG_MODE=true npm run dev
```

---

## 📄 License

This project is open source for **personal, non-commercial use only**.
Commercial use requires a paid license from the copyright holder.
See [LICENSE](LICENSE) for full terms.
