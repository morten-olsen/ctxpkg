import { type FeatureExtractionPipeline, pipeline } from '@huggingface/transformers';

class EmbedderService {
  #pipeline?: Promise<FeatureExtractionPipeline>;

  #setup = async () => {
    const extractor = await pipeline('feature-extraction', 'mixedbread-ai/mxbai-embed-large-v1');
    return extractor;
  };

  public getExtractor = async () => {
    if (!this.#pipeline) {
      this.#pipeline = this.#setup();
    }
    return await this.#pipeline;
  };

  public createEmbeddings = async (inputs: string[]) => {
    const extractor = await this.getExtractor();
    const output = await extractor(inputs, { pooling: 'cls' });
    return output.tolist();
  };
}

export { EmbedderService };
