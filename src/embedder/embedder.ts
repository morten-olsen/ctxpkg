import { type FeatureExtractionPipeline, pipeline } from '@huggingface/transformers';

// Instruction prefix for query embeddings (mxbai-embed format)
const QUERY_INSTRUCTION = 'Represent this sentence for searching relevant passages: ';

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

  /**
   * Create embeddings for documents (no instruction prefix).
   * Use this when indexing document chunks.
   */
  public createDocumentEmbeddings = async (inputs: string[]): Promise<number[][]> => {
    const extractor = await this.getExtractor();
    const output = await extractor(inputs, { pooling: 'cls' });
    return output.tolist();
  };

  /**
   * Create embedding for a search query (with instruction prefix).
   * Use this when searching for relevant documents.
   */
  public createQueryEmbedding = async (query: string): Promise<number[]> => {
    const extractor = await this.getExtractor();
    const instructedQuery = `${QUERY_INSTRUCTION}${query}`;
    const output = await extractor([instructedQuery], { pooling: 'cls' });
    return output.tolist()[0];
  };

  /**
   * @deprecated Use createDocumentEmbeddings or createQueryEmbedding instead.
   * Kept for backwards compatibility.
   */
  public createEmbeddings = async (inputs: string[]): Promise<number[][]> => {
    return this.createDocumentEmbeddings(inputs);
  };
}

export { EmbedderService };
