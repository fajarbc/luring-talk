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
export const formatSDPForQR = (data: any): string => {
  try {
    // Parse SDP if it's a string
    let sdp = data.sdp;
    if (typeof sdp === 'string') {
      sdp = JSON.parse(sdp);
    }

    // Compress SDP: keep only essential parts
    const lines = sdp.sdp.split('\n');
    const compressedLines: string[] = [];
    
    for (const line of lines) {
      // Keep: version, origin, session, timing, connection, media, attributes
      if (
        line.startsWith('v=') ||
        line.startsWith('o=') ||
        line.startsWith('s=') ||
        line.startsWith('t=') ||
        line.startsWith('c=') ||
        line.startsWith('m=') ||
        line.startsWith('a=rtcp:') ||
        line.startsWith('a=ice-') ||
        line.startsWith('a=fingerprint') ||
        line.startsWith('a=setup')
      ) {
        compressedLines.push(line);
      }
      // Include only first few candidates
      if (line.startsWith('a=candidate:')) {
        if (compressedLines.filter(l => l.startsWith('a=candidate:')).length < 3) {
          compressedLines.push(line);
        }
      }
    }

    const compressedSDP = compressedLines.join('\n');
    const compressed = {
      type: data.type,
      sdp: compressedSDP
    };

    return JSON.stringify(compressed);
  } catch (e) {
    console.error("Error compressing SDP:", e);
    return JSON.stringify(data);
  }
};

export const parseSDPFromQR = (dataString: string): any => {
  try {
    const parsed = JSON.parse(dataString);
    // If sdp is a string, parse it; otherwise return as-is
    if (typeof parsed.sdp === 'string' && parsed.sdp.startsWith('{')) {
      parsed.sdp = JSON.parse(parsed.sdp);
    }
    return parsed;
  } catch (e) {
    console.error("Failed to parse QR data", e);
    return null;
  }
};