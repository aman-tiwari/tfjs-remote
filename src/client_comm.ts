import * as socketio from 'socket.io-client';

import {Messages, RemoteVar} from './common';

const handleErr =
    (res, rej) => val => {
      if (val.error) throw val.error;

      return val.error ? rej(val.error) : res(val);
      ;
    }

export class Comm<T, Ops> {
  socket: SocketIOClient.Socket
  constructor() {}

  async connect(url: string) {
    this.socket = socketio.connect(url);
    this.socket.on(Messages.ServerError, this.errHandler.bind(this));
    return fromEvent(this.socket, 'connect', 5000)
  }

  errHandler(exn: string) {
    console.error(exn);
  }

  async updateVar(handle: RemoteVar<T>, arg: T) {
    return new Promise(
               (res, rej) => this.socket.emit(
                   Messages.Update, handle, arg, handleErr(res, rej))) as
        Promise<RemoteVar<T>>
  }

  async downloadVar(handle: RemoteVar<T>): Promise<RemoteVar<T>>{
    return new Promise(
               (res, rej) => this.socket.emit(
                   Messages.Download, handle, handleErr(res, rej))) as
    Promise<RemoteVar<T>>
  }

  async uploadVar(handle: RemoteVar<T>): Promise<RemoteVar<T>>{
    return new Promise(
               (res, rej) => {this.socket.emit(
                   Messages.Upload, handle, handleErr(res, rej))}) as
    Promise<RemoteVar<T>>
  };

  async emit(opInfo: Ops, args: RemoteVar<any>[]): Promise<RemoteVar<any>>{
    return new Promise((res, rej) => {
             this.socket.emit(Messages.Op, opInfo, args, handleErr(res, rej));
           }) as Promise<RemoteVar<any>>
  }

  async methodCall(
      thisHandle: RemoteVar<T>, methodName: string, args: RemoteVar<any>[]) {
    return new Promise(
        (res, rej) => {this.socket.emit(
            Messages.MethodCall, thisHandle, methodName, args,
            handleErr(res, rej))})
  }
}


async function fromEvent<T>(
    emitter: SocketIOClient.Socket, eventName: string,
    timeout: number): Promise<T> {
  return new Promise((resolve, reject) => {
           const rejectTimer = setTimeout(
               () => reject(`${eventName} event timed out`), timeout);
           if (rejectTimer.unref) rejectTimer.unref();
           const listener = (evtArgs: T) => {
             emitter.removeListener(eventName, listener);
             clearTimeout(rejectTimer);

             resolve(evtArgs);
           };
           emitter.on(eventName, listener);
         }) as Promise<T>;
}
