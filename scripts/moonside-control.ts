#!/usr/bin/env ts-node

/**
 * Minimal CLI helper that talks directly to the Firebase backend so we can
 * debug color and pixel commands without going through Homebridge.
 *
 * Usage examples:
 *   MOONSIDE_EMAIL="user@example.com" \
 *   MOONSIDE_PASSWORD="hunter2" \
 *   MOONSIDE_DEVICE_ID="88:57:21:74:0F:20" \
 *   npx ts-node --esm scripts/moonside-control.ts --hex ff8800 --brightness 60
 *
 *   MOONSIDE_EMAIL="user@example.com" \
 *   MOONSIDE_PASSWORD="hunter2" \
 *   MOONSIDE_DEVICE_ID="88:57:21:74:0F:20" \
 *   npx ts-node --esm scripts/moonside-control.ts --hex 00ff80 --pixels 0-79
 */

import { setTimeout as delay } from 'node:timers/promises';

const FIREBASE_API_KEY = 'AIzaSyCC-qQZqcZhxqsbO7GB0nXZShab9gV06Bk';
const FIREBASE_IDENTITY_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
const REALTIME_DATABASE_URL = 'https://moonside-501a1.firebaseio.com';

interface LoginResponse {
  idToken: string;
  localId: string;
}

interface Options {
  command?: string;
  color?: { r: number; g: number; b: number };
  brightness?: number;
  pixels?: number[];
  delayMs: number;
}

function parseChannel(value: string): number {
  const channel = Number(value);
  if (!Number.isFinite(channel) || channel < 0 || channel > 255) {
    throw new Error(`Invalid RGB channel value: ${value}`);
  }
  return channel;
}

function parsePixelList(input: string): number[] {
  const segments = input.split(',');
  const indices = new Set<number>();

  for (const segment of segments) {
    if (segment.includes('-')) {
      const [startRaw, endRaw] = segment.split('-', 2);
      const start = Number(startRaw);
      const end = Number(endRaw);
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new Error(`Invalid pixel range: ${segment}`);
      }
      const [min, max] = start <= end ? [start, end] : [end, start];
      for (let value = min; value <= max; value += 1) {
        indices.add(value);
      }
    } else {
      const value = Number(segment);
      if (!Number.isInteger(value)) {
        throw new Error(`Invalid pixel index: ${segment}`);
      }
      indices.add(value);
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}

function hexToColor(input: string): { r: number; g: number; b: number } {
  const match = input.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(match)) {
    throw new Error(`Invalid hex color: ${input}`);
  }
  return {
    r: parseInt(match.slice(0, 2), 16),
    g: parseInt(match.slice(2, 4), 16),
    b: parseInt(match.slice(4), 16),
  };
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(255, Math.round(value)));
}

function formatPixelPayload(color: { r: number; g: number; b: number }): string {
  const pad = (value: number) => clampByte(value).toString().padStart(3, '0');
  return `${pad(color.r)}${pad(color.g)}${pad(color.b)}`;
}

function buildColorCommand(color: { r: number; g: number; b: number }): string {
  return `COLOR${formatPixelPayload(color)}`;
}

function buildDeviceUrl(login: LoginResponse, deviceId: string): string {
  const encodedDeviceId = encodeURIComponent(deviceId);
  return `${REALTIME_DATABASE_URL}/userDevices/${login.localId}/${encodedDeviceId}.json?auth=${login.idToken}`;
}

async function authenticate(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${FIREBASE_IDENTITY_URL}?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Firebase auth failed: ${response.status} ${response.statusText} - ${details}`);
  }

  const payload = await response.json() as {
    idToken?: string;
    localId?: string;
  };

  if (!payload.idToken || !payload.localId) {
    throw new Error('Firebase auth response was missing idToken/localId.');
  }

  return {
    idToken: payload.idToken,
    localId: payload.localId,
  };
}

async function sendControl(login: LoginResponse, deviceId: string, controlData: string) {
  const url = buildDeviceUrl(login, deviceId);
  const payload = { controlData };

  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to send ${controlData}: ${response.status} ${response.statusText} - ${details}`);
  }

  const body = await response.json();
  console.log('Sent %s -> %s', controlData, JSON.stringify(body));
}

async function setPixels(
  login: LoginResponse,
  deviceId: string,
  color: { r: number; g: number; b: number },
  indices: number[],
  delayMs: number,
) {
  const payload = formatPixelPayload(color);

  for (const index of indices) {
    const command = `PIXEL,${index},${payload}`;
    await sendControl(login, deviceId, command);
    if (delayMs > 0) {
      await delay(delayMs);
    }
  }
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    delayMs: Number(process.env.MOONSIDE_PIXEL_DELAY ?? 50),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
    case '--command':
      options.command = argv[++i];
      break;
    case '--hex':
      options.color = hexToColor(argv[++i]);
      break;
    case '--rgb':
      options.color = {
        r: parseChannel(argv[++i]),
        g: parseChannel(argv[++i]),
        b: parseChannel(argv[++i]),
      };
      break;
    case '--brightness':
      options.brightness = Number(argv[++i]);
      break;
    case '--pixels':
      options.pixels = parsePixelList(argv[++i]);
      break;
    case '--pixel-delay':
      options.delayMs = Number(argv[++i]);
      break;
    default:
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function main() {
  const email = process.env.MOONSIDE_EMAIL;
  const password = process.env.MOONSIDE_PASSWORD;
  const deviceId = process.env.MOONSIDE_DEVICE_ID;

  if (!email || !password || !deviceId) {
    throw new Error('Set MOONSIDE_EMAIL, MOONSIDE_PASSWORD, and MOONSIDE_DEVICE_ID environment variables before running this script.');
  }

  const options = parseArgs(process.argv.slice(2));
  if (!options.command && !options.color && options.brightness === undefined) {
    throw new Error('Provide --command, --hex/--rgb, or --brightness so there is something to send.');
  }

  const login = await authenticate(email, password);

  if (options.brightness !== undefined) {
    const level = Math.max(1, Math.min(100, Math.round(options.brightness)));
    await sendControl(login, deviceId, `BRIGH${level}`);
  }

  if (options.command) {
    await sendControl(login, deviceId, options.command);
  }

  if (options.color) {
    if (options.pixels?.length) {
      await setPixels(login, deviceId, options.color, options.pixels, options.delayMs);
    } else {
      const command = buildColorCommand(options.color);
      await sendControl(login, deviceId, command);
    }
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
