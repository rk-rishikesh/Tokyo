import { redirect } from 'next/navigation'

/** Folded into a single page; kept so old links land in the right place. */
export default function Moved() {
  redirect('/app/access#without-this-app')
}
