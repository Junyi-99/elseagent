export { ConfigError, loadConfig } from "./load.ts";
export { expandHome } from "./paths.ts";
export {
  type ChannelsConfig,
  type CodexConfig,
  type Config,
  configSchema,
  configSections,
  DEFAULT_CONFIG_PATH,
  type IntegrationsConfig,
  PLACEHOLDER,
  type SlackConfig,
  type TelegramConfig,
} from "./schema.ts";
export { CONFIG_TEMPLATE } from "./template.ts";
