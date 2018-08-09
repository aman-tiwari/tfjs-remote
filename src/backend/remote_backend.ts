import {DataType, ENV, KernelBackend, tensor3d, Tensor3D} from '@tensorflow/tfjs-core';
import {MetadataTensor, ShapeBackend} from 'tfjs-shapes/dist/shape_backend';

import {Comm} from '../client_comm';
import {dtypeToTypedArrayCtor, RemoteVar, SerializedTensor, Var} from '../common';

type DataId = {
  remote: Promise<RemoteVar<any>>,
  meta: {shape: number[], dtype: DataType},
  [k: string]: any
};

type TypedArray = Float32Array|Int32Array|Uint8Array;

const typedArrayCtorToDtype = new Map
Object.keys(dtypeToTypedArrayCtor)
    .map(k => typedArrayCtorToDtype.set(dtypeToTypedArrayCtor[k], k));

export async function remoteBackend(url: string): Promise<KernelBackend> {
  const comm = new Comm<SerializedTensor, any>();
  await comm.connect(url);
  const shapeBackend = new ShapeBackend()

  // for fromPixels
  let canvas = null;
  if (ENV.get('IS_BROWSER')) {
    canvas = document.createElement('canvas');
  }

  const ret = {
    readSync(dataId: DataId) {
      throw new Error('Impossible to readSync when using RemoteBackend')
    },

    async read(dataId: DataId): Promise<TypedArray> {
      console.log(dataId);
      const {value} = await comm.downloadVar(await dataId['remote']);
      const {data, shape, dtype} = value;
      const nonView = ArrayBuffer.isView(data) ?
          data.buffer.slice(
              data.byteOffset, data.byteOffset + data.byteLength) :
          data;
      const numel = shape.reduce((x, y) => x * y, 1);
      const ctor = dtypeToTypedArrayCtor[dtype];
      const arr = new ctor(nonView, 0, numel);
      return arr;
    },

    write(dataId: DataId, values: TypedArray): void {
      console.log('write', dataId, values);
      const v: SerializedTensor = {
        dtype: dataId.meta.dtype,
        data: values.buffer.slice(
            values.byteOffset, values.byteOffset + values.byteLength),
        shape: dataId.meta.shape
      };
      dataId.remote = dataId.remote.then(
          rvar => comm.updateVar(rvar == null ? Var(v) : rvar, v));
    },

    async dispose() {
      await comm.emit('dispose', []);
    },

    fromPixels(
        pixels: ImageData|HTMLImageElement|HTMLCanvasElement|HTMLVideoElement,
        numChannels: number): Tensor3D {
      if (pixels == null) {
        throw new Error('pixels passed to tf.fromPixels() can not be null');
      }
      let vals: Uint8ClampedArray;
      // tslint:disable-next-line:no-any
      if (ENV.get('IS_NODE') && (pixels as any).getContext == null) {
        throw new Error(
            'When running in node, pixels must be an HTMLCanvasElement ' +
            'like the one returned by the `canvas` npm package');
      }
      // tslint:disable-next-line:no-any
      if ((pixels as any).getContext != null) {
        // tslint:disable-next-line:no-any
        vals = (pixels as any)
                   .getContext('2d')
                   .getImageData(0, 0, pixels.width, pixels.height)
                   .data;
      } else if (pixels instanceof ImageData) {
        vals = pixels.data;
      } else if (
          pixels instanceof HTMLImageElement ||
          pixels instanceof HTMLVideoElement) {
        if (canvas == null) {
          throw new Error(
              'Can\'t read pixels from HTMLImageElement outside ' +
              'the browser.');
        }
        canvas.width = pixels.width;
        canvas.height = pixels.height;
        canvas.getContext('2d').drawImage(
            pixels, 0, 0, pixels.width, pixels.height);
        vals = canvas.getContext('2d')
                   .getImageData(0, 0, pixels.width, pixels.height)
                   .data;
      } else {
        throw new Error(
            'pixels passed to tf.fromPixels() must be either an ' +
            `HTMLVideoElement, HTMLImageElement, HTMLCanvasElement or ` +
            `ImageData, but was ${(pixels as {}).constructor.name}`);
      }
      let values: Int32Array;
      if (numChannels === 4) {
        values = new Int32Array(vals);
      } else {
        const numPixels = pixels.width * pixels.height;
        values = new Int32Array(numPixels * numChannels);
        for (let i = 0; i < numPixels; i++) {
          for (let channel = 0; channel < numChannels; ++channel) {
            values[i * numChannels + channel] = vals[i * 4 + channel];
          }
        }
      }
      const outShape: [number, number, number] =
          [pixels.height, pixels.width, numChannels];
      return tensor3d(values, outShape, 'int32');
    },

    register(dataId: DataId, shape: number[], dtype: DataType) {
      shapeBackend.register(dataId, shape, dtype);
      // this seems wrong but idk
      dataId.meta = {shape: shape.slice(), dtype: dtype};
      dataId.remote = Promise.resolve(null);
    },

    memory() {
      const local = shapeBackend.memory();
      return {
        ...local, remote: comm.emit('remote', [])
      }
    },

    async time(f: () => void): Promise<{kernelMs: number}> {
      return {
        kernelMs: undefined
      }
    }
  };

  const isPrivate = (x: string) => x.endsWith('_')

  for (const k in shapeBackend) {
    if (k in ret || isPrivate(k)) continue;
    if (shapeBackend[k] instanceof Function) {
      console.log('wrapping', k);
      const shapeMetadataMethod = shapeBackend[k].bind(shapeBackend);
      ret[k] = (...args: any[]) => {
        console.log(k, args);
        const metadataTensor =
            shapeMetadataMethod(...args) as MetadataTensor<any>;
        if (metadataTensor == null) return metadataTensor;

        const rargs = args.map(
            a => (a !== undefined && a.dataId && a.dataId.remote) ?
                a.dataId.remote :
                Var(a));

        // implict async computation dag built here
        (metadataTensor.dataId as any).remote =
            Promise.all(rargs).then(rargs => comm.emit(k, rargs));

        // this seems wrong but idk
        (metadataTensor.dataId as any).meta = {
          shape: metadataTensor.shape.slice(),
          dtype: metadataTensor.dtype
        };

        return metadataTensor;
      }
    }
  }
  console.log('ret');
  return ret as any as KernelBackend;  // lol
}
