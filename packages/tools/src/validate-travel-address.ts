import { z } from 'zod';

import { parseJsonOrThrow, requireGoogleMapsApiKey } from './google-travel-shared';
import type { ToolDef } from './types';

const inputSchema = z.object({
  addressLines: z.array(z.string().min(1)).min(1).max(5),
  regionCode: z.string().optional(),
  locality: z.string().optional(),
  administrativeArea: z.string().optional(),
  postalCode: z.string().optional(),
});

export type ValidateTravelAddressInput = z.infer<typeof inputSchema>;

export interface ValidateTravelAddressResult {
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  possibleNextAction?: string;
  verdict?: {
    inputGranularity?: string;
    validationGranularity?: string;
    geocodeGranularity?: string;
    addressComplete?: boolean;
    hasInferredComponents?: boolean;
    hasReplacedComponents?: boolean;
  };
}

interface RawAddressValidationResponse {
  result?: {
    address?: { formattedAddress?: string };
    geocode?: { location?: { latitude?: number; longitude?: number }; placeId?: string };
    verdict?: ValidateTravelAddressResult['verdict'];
  };
}

export async function validateTravelAddress(
  input: ValidateTravelAddressInput
): Promise<ValidateTravelAddressResult> {
  const apiKey = requireGoogleMapsApiKey('validate_travel_address');
  const response = await fetch(
    `https://addressvalidation.googleapis.com/v1:validateAddress?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: {
          revision: 0,
          addressLines: input.addressLines,
          regionCode: input.regionCode,
          locality: input.locality,
          administrativeArea: input.administrativeArea,
          postalCode: input.postalCode,
        },
      }),
    }
  );

  const data = (await parseJsonOrThrow(
    response,
    'Google Address Validation API'
  )) as RawAddressValidationResponse;
  const lat = data.result?.geocode?.location?.latitude;
  const lng = data.result?.geocode?.location?.longitude;

  return {
    formattedAddress: data.result?.address?.formattedAddress,
    latitude: typeof lat === 'number' ? lat : undefined,
    longitude: typeof lng === 'number' ? lng : undefined,
    placeId: data.result?.geocode?.placeId,
    verdict: data.result?.verdict,
    possibleNextAction: data.result?.verdict?.addressComplete
      ? 'confirm'
      : 'collect_missing_fields',
  };
}

export const validateTravelAddressTool: ToolDef<
  ValidateTravelAddressInput,
  ValidateTravelAddressResult
> = {
  name: 'validate_travel_address',
  description:
    'Validate, standardize, and geocode a travel-critical address such as a hotel, pickup, embassy, clinic, or delivery point.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['addressLines'],
    properties: {
      addressLines: {
        type: 'array',
        items: { type: 'string' },
        description: 'Address lines in mailing-address order.',
      },
      regionCode: { type: 'string' },
      locality: { type: 'string' },
      administrativeArea: { type: 'string' },
      postalCode: { type: 'string' },
    },
  },
  handler: validateTravelAddress,
};
