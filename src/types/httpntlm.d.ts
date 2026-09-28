declare module "httpntlm" {
  interface NtlmOptions {
    url: string;
    username: string;
    password: string;
    domain?: string;
    workstation?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
  }
  interface NtlmResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: string | Buffer;
  }
  type Callback = (err: Error | null, res: NtlmResponse) => void;
  const httpntlm: {
    post(options: NtlmOptions, callback: Callback): void;
    get(options: NtlmOptions, callback: Callback): void;
  };
  export default httpntlm;
}
