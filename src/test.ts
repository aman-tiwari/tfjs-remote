import 'tfjs-shapes';

import * as tf from '@tensorflow/tfjs'
import fetch from 'node-fetch';

import {initRemote, loadHandler} from './client';

tf.io.registerLoadRouter(loadHandler);

// tslint:disable-next-line:no-any
(global as any).fetch = fetch;


async function main() {
  const rtf = (await initRemote('http://localhost:3060'))(tf);

  const ones = rtf.ones([5, 5]);

  const twos = rtf.add(ones, ones);
  const threes = twos.add(ones);
  const five = rtf.scalar(5);
  const fifteens = five.mul(threes);

  await twos.print();
  await threes.print();
  await fifteens.print();

  const fifteensArr = await fifteens.data();

  console.log(fifteensArr[0]);

  const modelInput = rtf.ones([1, 224, 224, 3]);
  const m = await rtf.loadModel(
      'https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/model.json');
  const r = m.predict(modelInput) as tf.Tensor;

  await r.print();

  console.log(
      await r.sum().data());  // should be 1 since model output is softmaxed
}

main();
