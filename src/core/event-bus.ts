/**
 * Event Bus — Pub/Sub message system backed by EventLedger
 * Agents communicate through topics, never directly.
 */
import EventEmitter from 'eventemitter3';
import { EventLedger } from './event-ledger.js';
import { Message, MessageTopic } from '../_shared/types.js';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('event-bus');

type MessageHandler = (message: Message) => void;

export class EventBus {
  private emitter = new EventEmitter();
  private ledger: EventLedger;

  constructor(ledger: EventLedger) {
    this.ledger = ledger;
  }

  publish(message: Omit<Message, 'id' | 'timestamp'>): Message | null {
    const persisted = this.ledger.append(message);
    if (!persisted) return null;

    this.emitter.emit(persisted.topic, persisted);
    this.emitter.emit('*', persisted);
    log.debug('Published', { topic: persisted.topic, sender: persisted.sender });
    return persisted;
  }

  batchPublish(messages: Array<Omit<Message, 'id' | 'timestamp'>>): Message[] {
    const persisted: Message[] = [];
    for (const msg of messages) {
      const result = this.publish(msg);
      if (result) persisted.push(result);
    }
    return persisted;
  }

  subscribe(handler: MessageHandler): void {
    this.emitter.on('*', handler);
  }

  subscribeTopic(topic: MessageTopic, handler: MessageHandler): void {
    this.emitter.on(topic, handler);
  }

  unsubscribe(handler: MessageHandler): void {
    this.emitter.off('*', handler);
  }

  unsubscribeTopic(topic: MessageTopic, handler: MessageHandler): void {
    this.emitter.off(topic, handler);
  }

  query(options: Parameters<EventLedger['query']>[0]): Message[] {
    return this.ledger.query(options);
  }

  findLast(options: Parameters<EventLedger['findLast']>[0]): Message | undefined {
    return this.ledger.findLast(options);
  }
}
