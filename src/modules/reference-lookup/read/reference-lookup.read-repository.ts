import {
  ReferenceLookupDomain,
  ReferenceLookupItem,
} from "@modules/reference-lookup/shared/reference-lookup.contracts";

export interface ListReferenceLookupInput {
  readonly domain: ReferenceLookupDomain;
  readonly search?: string;
  readonly ids?: readonly string[];
  readonly limit: number;
}

export interface ReferenceLookupReadRepository {
  listReferenceOptions(
    input: ListReferenceLookupInput,
  ): Promise<readonly ReferenceLookupItem[]>;
}
