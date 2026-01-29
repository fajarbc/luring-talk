/**
 * Attempts to discover the local IP address using a dummy WebRTC connection.
 * This works by creating an RTCPeerConnection and inspecting the ICE candidates.
 */
export const getLocalIP = async (): Promise<string> => {
  return new Promise((resolve) => {
    const pc = new RTCPeerConnection({ 
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302'] },
        { urls: ['stun:stun1.l.google.com:19302'] }
      ]
    });
    pc.createDataChannel('');
    
    let ipFound = false;
    
    // Create a timeout to resolve if we can't find it quickly
    const timeout = setTimeout(() => {
        pc.close();
        resolve('Unknown');
    }, 3000);

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      if (ipFound) return;
      
      // Basic regex to find IPv4 pattern in the candidate string
      const ipRegex = /([0-9]{1,3}(\.[0-9]{1,3}){3})/;
      const match = e.candidate.candidate.match(ipRegex);
      
      if (match && match[1]) {
        // Filter out localhost and 0.0.0.0
        if (match[1] !== '127.0.0.1' && match[1] !== '0.0.0.0') {
          ipFound = true;
          clearTimeout(timeout);
          pc.close();
          resolve(match[1]);
        }
      }
    };

    pc.createOffer()
      .then((sdp) => pc.setLocalDescription(sdp))
      .catch((err) => {
         console.error("Error creating offer:", err);
         clearTimeout(timeout);
         pc.close();
         resolve('Unknown');
      });
  });
};

/**
 * Compresses SDP by removing unnecessary lines and using compression.
 * Removes redundant candidates and large candidate pools to fit in QR code.
 */
import LZ from 'lz-string';

/**
 * Ultra-aggressive compression - keep essential SDP with all needed codec info.
 */
export const formatSDPForQR = (data: any): string => {
  try {
    // Parse SDP if it's a string
    let sdp = data.sdp;
    if (typeof sdp === 'string') {
      if (sdp.trim().startsWith('{')) {
        sdp = JSON.parse(sdp);
      } else {
        sdp = { sdp };
      }
    }

    // Ultra-aggressive compression
    const lines = sdp.sdp.split('\n');
    const compressedLines: string[] = [];
    let mediaIndex = -1;
    const mediaCodecs: {[key: number]: string[]} = {};
    const keptCandidateForMedia: {[key: number]: boolean} = {};
    const keptAnyCandidateForMedia: {[key: number]: boolean} = {};

    const isPrivateIp = (ip: string) => {
      if (ip.startsWith('10.')) return true;
      if (ip.startsWith('192.168.')) return true;
      const parts = ip.split('.').map(Number);
      if (parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      return false;
    };
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Track media sections and extract codecs
      if (line.startsWith('m=')) {
        mediaIndex++;
        // Extract codec numbers from m= line (e.g., "m=audio 40446 UDP/TLS/RTP/SAVPF 111 63 9...")
        const parts = line.split(' ');
        if (parts.length > 3) {
          mediaCodecs[mediaIndex] = parts.slice(3); // codecs are everything after port and protocol
        }
        compressedLines.push(line);
        continue;
      }
      
      // Keep essential SDP structure
      if (
        line.startsWith('v=') ||
        line.startsWith('o=') ||
        line.startsWith('s=') ||
        line.startsWith('t=') ||
        line.startsWith('c=')
      ) {
        compressedLines.push(line);
        continue;
      }
      
      // Keep critical attributes (one of each per media)
      if (
        line.startsWith('a=ice-ufrag:') ||
        line.startsWith('a=ice-pwd:') ||
        line.startsWith('a=fingerprint:') ||
        line.startsWith('a=setup:') ||
        line.startsWith('a=rtcp-mux') ||
        line.startsWith('a=rtcp:') ||
        line.startsWith('a=mid:') ||
        line.startsWith('a=sendrecv') ||
        line.startsWith('a=recvonly') ||
        line.startsWith('a=sendonly') ||
        line.startsWith('a=inactive')
      ) {
        compressedLines.push(line);
        continue;
      }
      
      // Keep ALL rtpmap and fmtp (needed for codec negotiation)
      if (line.startsWith('a=rtpmap:') || line.startsWith('a=fmtp:')) {
        compressedLines.push(line);
        continue;
      }
      
      // Keep a minimal set of ICE candidates (one host candidate per media)
      if (line.startsWith('a=candidate:')) {
        if (mediaIndex >= 0 && !keptCandidateForMedia[mediaIndex]) {
          const ipMatch = line.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
          const isHost = line.includes(' typ host');
          const isUdp = line.includes(' udp ');
          const isPrivateHost = ipMatch ? isPrivateIp(ipMatch[1]) : true; // allow mDNS host candidates
          if (isHost && isUdp && isPrivateHost) {
            compressedLines.push(line);
            keptCandidateForMedia[mediaIndex] = true;
            keptAnyCandidateForMedia[mediaIndex] = true;
          }
        }
        continue;
      }

      if (line.startsWith('a=end-of-candidates')) {
        if (mediaIndex >= 0 && keptAnyCandidateForMedia[mediaIndex]) {
          compressedLines.push(line);
        }
        continue;
      }

      // Skip ALL other attributes
    }

    const compressedSDP = compressedLines.join('\n');
    const payload = {
      type: data.type,
      sdp: compressedSDP
    };
    
    // Compress using LZ
    const jsonStr = JSON.stringify(payload);
    const compressed = LZ.compressToBase64(jsonStr);
    
    console.log(`Original: ${jsonStr.length} chars, Compressed: ${compressed.length} chars (${Math.round(100 * compressed.length / jsonStr.length)}%)`);
    
    return compressed;
  } catch (e) {
    console.error("Error formatting SDP:", e);
    return JSON.stringify(data);
  }
};

export const parseSDPFromQR = (dataString: string): any => {
  const tryParse = (text: string) => {
    try {
      // Try LZ decompression first
      const decompressed = LZ.decompressFromBase64(text);
      if (decompressed) {
        const parsed = JSON.parse(decompressed);
        if (parsed && typeof parsed.sdp === 'string') {
          // Ensure the SDP has proper line breaks
          if (parsed.sdp.includes('\\r\\n')) {
            parsed.sdp = parsed.sdp.replace(/\\r\\n/g, '\r\n').replace(/\\n/g, '\n');
          }
        }
        return parsed;
      }
    } catch {
      // LZ decompression failed, try direct JSON parse
    }

    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.sdp === 'string') {
        if (parsed.sdp.includes('\\r\\n')) {
          parsed.sdp = parsed.sdp.replace(/\\r\\n/g, '\r\n').replace(/\\n/g, '\n');
        }
        if (parsed.sdp.trim().startsWith('{')) {
          parsed.sdp = JSON.parse(parsed.sdp);
        }
      }
      return parsed;
    } catch {
      return null;
    }
  };

  const decodeNumericBytes = (input: string) => {
    const values = input.split(/\s+/).map((v) => Number(v)).filter((v) => Number.isFinite(v));
    if (!values.length || values.some((v) => v < 0 || v > 255)) return null;
    try {
      const bytes = new Uint8Array(values);
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return null;
    }
  };

  const trimmed = dataString.trim();
  const candidates: string[] = [trimmed];

  if (/^\d+(\s+\d+)+$/.test(trimmed)) {
    const decoded = decodeNumericBytes(trimmed);
    if (decoded) candidates.push(decoded);
  }

  if (/%[0-9A-Fa-f]{2}/.test(trimmed)) {
    try {
      candidates.push(decodeURIComponent(trimmed));
    } catch {
      // ignore
    }
  }

  if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length % 4 === 0) {
    try {
      candidates.push(atob(trimmed));
    } catch {
      // ignore
    }
  }

  for (const candidate of candidates) {
    const parsed = tryParse(candidate);
    if (parsed) return parsed;
  }

  console.error("Failed to parse QR data");
  return null;
};