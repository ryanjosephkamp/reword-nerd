# Model guidance index

These artifacts document the evidence behind every selectable reword-nerd model profile. Runtime strategies use stable family-level IDs; a future flagship-model update can therefore change the reference model and strategy version without changing exported lineage.

“Recommended” here means the strongest guidance supported by first-party material reviewed on **2026-08-11**. It is not a permanent claim of optimality. Provider behavior, context limits, account entitlements, preview availability, and chat-product interfaces can change. Review this directory at least every **90 days**; the next scheduled review is **2026-11-09**. The application performs no runtime network check.

| UI profile | Runtime strategy | Reference model | Context default | Evidence | Artifact |
|---|---|---|---:|---|---|
| Alibaba / Qwen | `alibaba-qwen-v1` | Qwen3.7 Max | 1,000,000 | High | [Alibaba / Qwen](alibaba-qwen.md) |
| Anthropic / Claude | `anthropic-claude-v1` | Claude Opus 5 | 1,000,000 | High | [Anthropic / Claude](anthropic-claude.md) |
| Custom model | `custom-neutral-v1` | User supplied | User supplied | Design policy | [Custom model](custom-model.md) |
| DeepSeek / V4 Pro | `deepseek-v4-pro-v1` | DeepSeek V4 Pro | 1,000,000 | Medium | [DeepSeek / V4 Pro](deepseek-v4-pro.md) |
| Google / Gemini | `google-gemini-v1` | Gemini 3.1 Pro Preview | 1,048,576 | High | [Google / Gemini](google-gemini.md) |
| Meta / Muse | `meta-muse-v1` | Muse Spark 1.1 | 1,000,000 | Medium | [Meta / Muse](meta-muse.md) |
| MiniMax / M3 | `minimax-m3-v1` | MiniMax M3 | 1,000,000 | High | [MiniMax / M3](minimax-m3.md) |
| Mistral / Large 3 | `mistral-large-3-v1` | Mistral Large 3 | 256,000 | High | [Mistral / Large 3](mistral-large-3.md) |
| MoonshotAI / Kimi | `moonshot-kimi-v1` | Kimi K3 | 1,000,000 | Medium-high | [MoonshotAI / Kimi](moonshot-kimi.md) |
| OpenAI / ChatGPT | `openai-chatgpt-v1` | GPT-5.6 Sol | 1,050,000 | High | [OpenAI / ChatGPT](openai-chatgpt.md) |
| xAI / Grok | `xai-grok-v1` | Grok 4.5 | 500,000 | Medium | [xAI / Grok](xai-grok.md) |
| Z.AI / GLM | `zai-glm-v1` | GLM-5.1 | 200,000 | Medium | [Z.AI / GLM](zai-glm.md) |

## Method

The review prioritizes official model pages, provider prompt guides, technical reports, and release notes. Product announcements establish capabilities but do not by themselves justify detailed prompt rules. API-only advice—reasoning effort, caching identifiers, structured-output flags, and similar controls—is documented but excluded from prompts intended for manual chat use. Each artifact separates supported findings, reword-nerd’s cautious inference, evidence gaps, and the exact concise guidance injected at runtime.

## Change log

- **2026-08-11:** Initial profile-wide review; established strategy version `2026-08-11-v1` and the manifest-v2 provenance fields.
