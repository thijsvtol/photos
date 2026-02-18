/**
 * Reverse Geocoding Utilities
 * Extract city names from GPS coordinates
 */

/**
 * Get city name from coordinates using OpenStreetMap Nominatim API
 * This is a free reverse geocoding service
 */
export async function getCityFromCoordinates(
  latitude: number,
  longitude: number
): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PhotoGallery/1.0', // Required by Nominatim
      },
    });

    if (!response.ok) {
      console.error('Reverse geocoding failed:', response.statusText);
      return null;
    }

    const data = await response.json() as any;
    
    // Extract city name from address components
    // Priority: city > town > village > municipality
    const address = data.address;
    if (!address) return null;

    return (
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.county ||
      null
    );
  } catch (error) {
    console.error('Error getting city from coordinates:', error);
    return null;
  }
}

/**
 * Batch reverse geocode multiple coordinates
 * Includes rate limiting to respect API limits (1 request per second for Nominatim)
 */
export async function batchGetCitiesFromCoordinates(
  coordinates: Array<{ latitude: number; longitude: number; id: string }>
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  for (const coord of coordinates) {
    const city = await getCityFromCoordinates(coord.latitude, coord.longitude);
    if (city) {
      results.set(coord.id, city);
    }
    
    // Rate limiting: wait 1 second between requests for Nominatim
    await new Promise(resolve => setTimeout(resolve, 1100));
  }

  return results;
}
