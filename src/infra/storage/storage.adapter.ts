export interface SignedUrlResult {
  url: string;
  expiresAt: number;
  method: "PUT" | "GET";
}

export interface UploadInput {
  key: string;
  contentType: string;
}

export interface DownloadInput {
  key: string;
}

export interface StorageAdapter {
  getUploadUrl(input: UploadInput): Promise<SignedUrlResult>;
  getDownloadUrl(input: DownloadInput): Promise<SignedUrlResult>;
  deleteObject?(key: string): Promise<void>;
  exists?(key: string): Promise<boolean>;
}
