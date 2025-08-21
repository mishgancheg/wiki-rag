import { CHUNK_CHARS_LIMIT } from "./constants";

const LNG = `Весь текст переводи на РУССКИЙ язык`;

export const PROMPT_FOR_CHUNKING = `
You are an expert assistant specializing in high-quality text chunking for use in Retrieval-Augmented Generation (RAG) systems.

Your task is to analyze the provided content and split it into **meaningful and logically connected chunks**, suitable for indexing and retrieval in RAG pipelines.

**Chunk requirements:**
- Break content into chunks that do not exceed ${CHUNK_CHARS_LIMIT} characters.
- Each chunk must preserve the **original text exactly**, with no omissions, reductions, or paraphrasing.
- Preserve all formatting.
- Each chunk should be **cohesive** and **self-contained**, meaning it should make sense and be interpretable on its own.
- Chunk boundaries should follow the **logical flow** of the original content.

IMPORTANT: DO NOT LOSE ANYTHING FROM CONTENT. All content should enter the chunks. Without exception.
Therefore do the following:
- Break content into chunks.
- Check if the entire text of the content is in chopped chunks. If something is missing, add.
- place the chunks in an ARRAY OF RESULTS

**Output the result in the JSON structure pointed in \`response_format\`**

${LNG}
`;

export const getPromptForQuestions = (minQuestions: number = 3, maxQuestions: number = 20, isContext: boolean = false) => {
  const contextAdd = isContext ?  `- Look at the text in the ---CONTEXT---. Think about what else can refer to the context.
- If you understand that this text can be interesting in the ---CONTEXT--- of another requested information, then add questions to that context.` : ''

  return `
You are an expert specializing in inventing questions for the text.

Your task is to generate questions that users might ask to retrieve the information from given ---TEXT---.

**Questions requirements:**
- Generate **${minQuestions}-${maxQuestions} natural language questions** that users might ask to retrieve the information from given ---TEXT---.
- Make questions diverse: factual, conceptual, procedural, comparative
- Use natural language that users would actually search for
- Include questions about key concepts, processes, and details
- Questions should help users find this specific information
${contextAdd}
- You can form questions of a more general plan than the ---TEXT--- but avoid overly generic questions that could apply to many documents.
- If you can come up with more than ${maxQuestions} questions - come up with more!

**Output the result in the JSON structure pointed in \`response_format\`**

${LNG}
`
}
