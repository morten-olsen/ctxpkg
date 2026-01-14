import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { HumanMessage, AIMessage } from '@langchain/core/messages';
import type { ReactAgent } from 'langchain';

import { createAgent } from '../agent/agent.ts';
import { fileTools } from '../tools/files/files.ts';
import { gitTools } from '../tools/git/git.ts';
import { createReferenceTools } from '../tools/references/references.ts';
import { Services } from '../utils/utils.services.ts';

const createDefaultAgent = async (services?: Services): Promise<{ agent: ReactAgent; services: Services }> => {
  const svc = services ?? new Services();
  const referenceTools = createReferenceTools(svc);

  const tools = [...Object.values(fileTools), ...Object.values(gitTools), ...Object.values(referenceTools)];

  const systemPrompt = `You are a helpful software engineering assistant. 
You have access to tools to read files, search the codebase, interact with git, and search reference documentation.

Available tool categories:
- File tools: Read file contents, glob patterns, search files, get file stats
- Git tools: Repository status, diffs, commit history
- Reference tools: List and search semantic document collections

When asked about documentation or guides, use the reference search tools.
When asked to create a commit message, analyze the changes first using git diff and git status.
Always be concise and accurate.`;

  const agent = await createAgent(tools, systemPrompt);
  return { agent, services: svc };
};

const prompt = async (agent: ReactAgent, userInput: string) => {
  const stream = await agent.stream(
    {
      messages: [new HumanMessage(userInput)],
    },
    {
      configurable: { thread_id: 'interactive-session' },
    },
  );

  for await (const chunk of stream) {
    // LangGraph createReactAgent streaming format:
    // chunks contain nodes like "model_request", "tools", etc.
    // Each node has a "messages" array with the actual messages

    // Check if this chunk has any node with messages
    const nodeNames = Object.keys(chunk);
    for (const nodeName of nodeNames) {
      const nodeData = chunk[nodeName];
      if (nodeData && nodeData.messages && Array.isArray(nodeData.messages)) {
        for (const message of nodeData.messages) {
          if (message instanceof AIMessage && message.tool_calls) {
            for (const toolCall of message.tool_calls) {
              console.log(`Calling ${toolCall.name} with ${JSON.stringify(toolCall.args)}`);
            }
          }
          if (message instanceof AIMessage && message.content) {
            console.log(`AI: ${message.content}`);
          }
        }
      }
    }
  }
};

const startSession = async () => {
  const { agent, services } = await createDefaultAgent();
  const rl = readline.createInterface({ input, output });

  console.log('Agent initialized. Type "exit" or "quit" to stop.');

  try {
    while (true) {
      const userInput = await rl.question('\nUser: ');

      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        break;
      }

      if (!userInput.trim()) continue;

      try {
        await prompt(agent, userInput);
      } catch (error) {
        console.error('Error:', error);
      }
    }
  } finally {
    rl.close();
    await services.destroy();
  }
};

export { startSession, createDefaultAgent, prompt };
