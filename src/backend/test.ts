import 'tfjs-shapes';

import * as tf from '@tensorflow/tfjs';
import fetch from 'node-fetch';

import {remoteBackend} from './remote_backend';

(global as any).fetch = fetch;

async function main() {
  const rb = await remoteBackend('http://localhost:3061');
  tf.ENV.registerBackend('remote', () => rb);
  tf.setBackend('remote');

  const ones = tf.ones([5, 5, 3, 3]) as tf.Tensor4D;
  const img = tf.randomNormal([1, 224, 224, 3]) as tf.Tensor4D;
  const res = tf.conv2d(img, ones, 1, 'same');
  console.log(await res.data());

  // workaround tfjs-core not recognizing fetch polyfills
  tf.ENV.set('IS_BROWSER', true);
  const mP = tf.loadModel(
      'https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/model.json');
  tf.ENV.set('IS_BROWSER', false);
  const m = await mP;
  const preds = m.predict(img) as tf.Tensor;
  console.log(await preds.sum().data())  // == 1.0
}

main();
