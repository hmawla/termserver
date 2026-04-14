import os from 'os';

export function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface) {
      if (!addr.internal && addr.family === 'IPv4') {
        return addr.address;
      }
    }
  }
  return '127.0.0.1';
}
