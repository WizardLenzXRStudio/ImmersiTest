/**
 * Brand and outbound-link configuration — the ONE place these values live.
 *
 * Home, Help, the header and the footer all read from here, so changing a value
 * once updates every place it appears. Do not inline any of these strings in a
 * component; import them.
 */

export const PRODUCT = 'ImmersiTest';
export const TAGLINE = 'Test the Experience. Trust the Immersion.';

/** Short vendor name for prose, and the legal entity for the copyright line. */
export const VENDOR = 'Wizardlenz XR Studio';
export const VENDOR_LEGAL = 'Wizardlenz XR Studio (OPC) Pvt Ltd';

/** Official Wizardlenz XR Studio website. Single source for every company link. */
export const COMPANY_URL = 'https://wizardlenzxrstudio.com/';

/**
 * ===========================================================================
 *  UPDATE WHEN THE LISTING URL IS ISSUED
 * ===========================================================================
 * Unity Asset Store destination for the ImmersiTest package.
 *
 * This currently points at the Asset Store itself. When the listing URL is
 * issued, change this ONE constant — every call to action on the site reads
 * from it, so nothing else needs touching.
 */
export const UNITY_ASSET_STORE_URL = 'https://assetstore.unity.com/';

/** Copy for the "get the Unity package" call to action. */
export const unityCta = () => ({
  label: 'Get ImmersiTest from Unity Asset Store',
  blurb:
    'Install the ImmersiTest Unity Package directly from the Unity Asset Store and run '
    + 'XR application tests from inside your Unity project.',
});

/** Current year, evaluated at render time so the footer never goes stale. */
export const currentYear = () => new Date().getFullYear();
