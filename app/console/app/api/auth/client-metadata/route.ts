/**
 * This deployment's OAuth client metadata document.
 *
 * For providers that support CIMD (Granola does), the client *id* is this URL.
 * Instead of registering an application and holding a secret, the authorization
 * server fetches this document to learn who is asking — so the only thing
 * needed to offer Granola is that this route is publicly reachable.
 */
import { NextResponse } from 'next/server'
import { APP_NAME, APP_URL, baseUrl, callbackUrl, clientMetadataUrl, SCOPES } from '@k01/connect'

export async function GET() {
  return NextResponse.json(
    {
      client_id: clientMetadataUrl(),
      client_name: APP_NAME,
      client_uri: baseUrl(),
      redirect_uris: [callbackUrl('granola')],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // Public client: proof of possession is PKCE, not a shared secret.
      token_endpoint_auth_method: 'none',
      application_type: 'web',
      // Hand-copying this is how the document and the request come to describe
      // two different clients.
      scope: SCOPES.granola.join(' '),
    },
    { headers: { 'cache-control': 'public, max-age=3600' } },
  )
}
