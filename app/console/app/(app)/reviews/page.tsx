import { redirect } from 'next/navigation'

/** Reviews became Publish: your unpublished changes and anything awaiting your approval. */
export default function Reviews() {
  redirect('/app/publish')
}
