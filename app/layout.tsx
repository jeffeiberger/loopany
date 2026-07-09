import './globals.css'

export const metadata = {
  title: 'Loopany',
  description: 'You\'re in good company.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
