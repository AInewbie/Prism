# Provider integration notes

Read and checked against official documentation on **13 September 2026**.
These references are not evidence of successful live account calls.
No paid requests were made while building this release.

| Provider           | Implemented interface                                         | Official documentation                                                                                                                                                |
| ------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI             | POST /v1/responses; GET /v1/models                            | [Responses](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create), [File inputs](https://developers.openai.com/api/docs/guides/file-inputs) |
| Gemini             | POST /v1beta/models/{model}:generateContent and /v1beta/interactions; paginated models | [Generate content](https://ai.google.dev/api/generate-content), [Document processing](https://ai.google.dev/gemini-api/docs/document-processing), [Image understanding](https://ai.google.dev/gemini-api/docs/image-understanding), [Models](https://ai.google.dev/api/models) |
| xAI / Grok         | POST /v1/responses; GET /v1/models                            | [Generate text](https://docs.x.ai/developers/model-capabilities/text/generate-text), [Responses](https://docs.x.ai/developers/rest-api-reference/inference/responses) |
| Anthropic / Claude | POST /v1/messages, API version 2023-06-01; paginated models   | [Create message](https://platform.claude.com/docs/en/api/messages/create), [Vision](https://platform.claude.com/docs/en/build-with-claude/vision), [PDF support](https://platform.claude.com/docs/en/build-with-claude/pdf-support), [List models](https://platform.claude.com/docs/en/api/models/list) |

The xAI text-generation guide was last updated **29 May 2026** when opened.
Other linked pages are live references; the access date above is used here.

Decisions:

- Use xAI's Responses interface for the new app. Its documentation describes
  Chat Completions as legacy. Existing VolModel adapters were not changed.
- Require explicit model selection instead of assuming account availability.
  Listing a model does not prove support for this app's endpoint or output limit.
- Make one request per selected model. Surface failure/cancellation without replay.
- Preserve visible text and token counts, flag incomplete outputs, and omit
  internal reasoning fields.
- Treat candidate answers as untrusted source material during synthesis.
  Source labels, human scores and notes are included. Requested disagreement
  handling is not verified factual adjudication.
- No model receives execution tools from this app.
- Default-off visual synthesis uses bounded base64 image inputs only for OpenAI,
  Gemini and Claude. Grok remains blocked until a verified image-input contract
  is implemented. Preview responses contain image metadata, never raw base64.
- Default-off PDF synthesis uses bounded base64 document inputs only for OpenAI,
  Gemini and Claude. Grok remains blocked until a verified PDF-input contract is
  implemented. Preview responses contain PDF metadata, never raw base64.

## Candidate next improvements

1. **Retain alternate combined drafts.** Small effort; useful when trying more
   than one synthesis approach. Currently export a draft before replacing it.
2. **Custom rubrics and pairwise comparison.** Medium effort; a product hypothesis
   based on the requested workflow, not a measured reliability improvement.
3. **Spend estimates.** Medium effort plus pricing maintenance. Actual prices need
   fresh verification; output limits alone cannot guarantee a dollar cap.

Prioritize user feedback and the first authorized real-account test over adding
these features.
