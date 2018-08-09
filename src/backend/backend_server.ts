import '@tensorflow/tfjs-node'

import * as tf from '@tensorflow/tfjs-core';
import * as socketio from 'socket.io';

import {deserializeTensor, Messages, RemoteVar, SerializedTensor, serializeTensor, Var} from '../common';

const serv = socketio();

const vars = new Map<string, RemoteVar<tf.Tensor>>();

function deserializeIfTensor(obj: any) {
  return obj.dtype && obj.shape && obj.data ? deserializeTensor(obj) : obj;
}

function remoteToLocal(args: any[]) {
  return args.map(
      t => t.value !== null ? deserializeIfTensor(t.value) :
                              vars.get(t.id).value);
}

const logger = enable => (...args) => enable ? console.log(...args) : void 0;

const log = logger(true);

function handler(socket: SocketIO.Socket) {
  const backend = tf.ENV.findBackend(tf.ENV.getBestBackendType());

  socket.on(Messages.Upload, (data: RemoteVar<any>, reply) => {
    log('upload', data);
    const ret = {...data, value: deserializeTensor(data.value)};
    vars.set(data.id, ret);
    return reply({...data, value: null})
  });

  socket.on(Messages.Download, async (data: RemoteVar<any>, reply) => {
    log('download', data);
    const val = vars.get(data.id);
    const ret = {...val, value: await serializeTensor(val.value)};
    return reply(ret);
  });

  socket.on(
      Messages.Update,
      async (target: RemoteVar<any>, val: SerializedTensor, reply) => {
        log('update', target);
        let obj;
        if (vars.has(target.id)) {
          obj = vars.get(target.id)
          if (obj.value && obj.value.dispose) {
            obj.value.dispose()
          }
        } else {
          vars.set(target.id, target);
          obj = target;
        }
        obj.value = deserializeTensor(val);
        return reply({...obj, value: null});
      });

  socket.on(
      Messages.Op,
      async (op: string, rargs: RemoteVar<SerializedTensor>[], reply) => {
        log('op', op, rargs, vars);
        const args = remoteToLocal(rargs);
        const res: tf.Tensor = backend[op].bind(backend)(...args);
        const resVar: RemoteVar<tf.Tensor> = Var(res);

        if (res !== undefined) {
          vars.set(resVar.id, resVar);
        }
        console.log('ret', resVar);
        return reply({...resVar, value: null});
      });

  socket.on(
      Messages.MethodCall,
      async (
          thisHandle: RemoteVar<SerializedTensor>, methodName: string,
          rargs: RemoteVar<SerializedTensor>[], reply) => {
        log('meth', thisHandle, methodName, rargs);
        const obj = vars.get(thisHandle.id);
        const args = remoteToLocal(rargs);
        const res: tf.Tensor =
            (obj.value as any)[methodName].bind(obj.value)(...args);
        const resVar = Var(res);
        if (res !== undefined) {
          vars.set(resVar.id, resVar);
        }
        return reply({...resVar, value: null});
      })
}

serv.listen(3061).on('connection', handler);
