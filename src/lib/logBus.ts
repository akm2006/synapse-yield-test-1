// src/lib/logBus.ts
import { EventEmitter } from 'events';

const channels = new Map<string, EventEmitter>();

export function getLogChannel(id: string): EventEmitter {
  let ch = channels.get(id);
  if (!ch) {
    ch = new EventEmitter();
    channels.set(id, ch);
  }
  return ch;
}

export function emitLog(id: string, msg: string) {
  const ch = channels.get(id);
  if (ch) ch.emit('log', msg);
  console.log(`[LOG:${id}] ${msg}`);
}

export function endLog(id: string) {
  const ch = channels.get(id);
  if (ch) {
    ch.emit('done');
    ch.removeAllListeners();
    channels.delete(id);
  }
}
