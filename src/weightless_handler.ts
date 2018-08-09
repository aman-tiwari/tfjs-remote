/**
 * @license
 * Copyright 2018 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

/**
 * IOHandler implementations based on HTTP requests in the web browser.
 * Same as the one tfjs-core except doesn't load weights, only the weights
 * manifest and model architecture. This works fine for just getting metadata
 *
 * Uses [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API).
 */

import {getModelArtifactsInfoForJSON} from '@tensorflow/tfjs-core/dist/io/io_utils';
import {IORouter, IORouterRegistry} from '@tensorflow/tfjs-core/dist/io/router_registry';
import {IOHandler, ModelArtifacts, SaveResult, WeightsManifestConfig, WeightsManifestEntry} from '@tensorflow/tfjs-core/dist/io/types';
import {assert} from '@tensorflow/tfjs-core/dist/util';

export class BrowserHTTPRequestWeightless implements IOHandler {
  protected readonly path: string;
  protected readonly requestInit: RequestInit;

  readonly DEFAULT_METHOD = 'POST';

  static readonly URL_SCHEMES = ['remote://http://', 'remote://https://'];

  constructor(path: string, requestInit?: RequestInit) {
    if (typeof fetch === 'undefined') {
      throw new Error(
          // tslint:disable-next-line:max-line-length
          'browserHTTPRequest is not supported outside the web browser without a fetch polyfill.');
    }

    assert(
        path != null && path.length > 0,
        'URL path for browserHTTPRequest must not be null, undefined or ' +
            'empty.');
    this.path = path;

    if (requestInit != null && requestInit.body != null) {
      throw new Error(
          'requestInit is expected to have no pre-existing body, but has one.');
    }
    this.requestInit = requestInit || {};
  }

  async save(modelArtifacts: ModelArtifacts): Promise<SaveResult> {
    if (modelArtifacts.modelTopology instanceof ArrayBuffer) {
      throw new Error(
          'BrowserHTTPRequest.save() does not support saving model topology ' +
          'in binary formats yet.');
    }

    const init = Object.assign({method: this.DEFAULT_METHOD}, this.requestInit);
    init.body = new FormData();

    const weightsManifest: WeightsManifestConfig = [{
      paths: ['./model.weights.bin'],
      weights: modelArtifacts.weightSpecs,
    }];
    const modelTopologyAndWeightManifest = {
      modelTopology: modelArtifacts.modelTopology,
      weightsManifest
    };

    init.body.append(
        'model.json',
        new Blob(
            [JSON.stringify(modelTopologyAndWeightManifest)],
            {type: 'application/json'}),
        'model.json');

    if (modelArtifacts.weightData != null) {
      init.body.append(
          'model.weights.bin',
          new Blob(
              [modelArtifacts.weightData], {type: 'application/octet-stream'}),
          'model.weights.bin');
    }

    const response = await fetch(this.path, init);

    if (response.status === 200) {
      return {
        modelArtifactsInfo: getModelArtifactsInfoForJSON(modelArtifacts),
        responses: [response],
      };
    } else {
      throw new Error(
          `BrowserHTTPRequest.save() failed due to HTTP response status ` +
          `${response.status}.`);
    }
  }

  /**
   * Load model artifacts via HTTP request(s).
   *
   * See the documentation to `browserHTTPRequest` for details on the saved
   * artifacts.
   *
   * @returns The loaded model artifacts (if loading succeeds).
   */
  async load(): Promise<ModelArtifacts> {
    const modelConfigRequest = await fetch(this.path, this.requestInit);
    const modelConfig = await modelConfigRequest.json();
    const modelTopology = modelConfig['modelTopology'];
    const weightsManifest = modelConfig['weightsManifest'];

    // We do not allow both modelTopology and weightsManifest to be missing.
    if (modelTopology == null && weightsManifest == null) {
      throw new Error(
          `The JSON from HTTP path ${this.path} contains neither model ` +
          `topology or manifest for weights.`);
    }

    let weightSpecs: WeightsManifestEntry[];
    let weightData: ArrayBuffer;
    if (weightsManifest != null) {
      const weightsManifest =
          modelConfig['weightsManifest'] as WeightsManifestConfig;
      weightSpecs = [];
      for (const entry of weightsManifest) {
        weightSpecs.push(...entry.weights);
      }

      let pathPrefix = this.path.substring(0, this.path.lastIndexOf('/'));
      if (!pathPrefix.endsWith('/')) {
        pathPrefix = pathPrefix + '/';
      }

      const fetchURLs: string[] = [];
      weightsManifest.forEach(weightsGroup => {
        weightsGroup.paths.forEach(path => {
          fetchURLs.push(pathPrefix + path);
        });
      });
      weightData = null;
      // concatenateArrayBuffers(
      //    await loadWeightsAsArrayBuffer(fetchURLs, this.requestInit));
    }

    return {modelTopology, weightSpecs, weightData};
  }
}

export const weightlessHttpRequestRouter: IORouter = (url: string) => {
  console.log('schemes', BrowserHTTPRequestWeightless.URL_SCHEMES, url);
  if (typeof fetch === 'undefined') {
    // browserHTTPRequest uses `fetch`, if one wants to use it in node.js
    // they have to setup a global fetch polyfill.
    return null;
  } else {
    for (const scheme of BrowserHTTPRequestWeightless.URL_SCHEMES) {
      if (url.startsWith(scheme)) {
        const [, schemeLess] = url.split('remote://')
        return browserHTTPRequestWeightless(schemeLess);
      }
    }
    return null;
  }
};


IORouterRegistry.registerSaveRouter(weightlessHttpRequestRouter);
IORouterRegistry.registerLoadRouter(weightlessHttpRequestRouter);
console.log(
    IORouterRegistry.getLoadHandlers('remote://http://hello.com/model.json'));

export function browserHTTPRequestWeightless(
    path: string, requestInit?: RequestInit): IOHandler {
  return new BrowserHTTPRequestWeightless(path, requestInit);
}
