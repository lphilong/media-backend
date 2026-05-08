export interface AuthSecurityVersionReader {
  readAuthSecurityVersion(): Promise<string>;
}
