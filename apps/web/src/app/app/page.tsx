'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AppRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/app/capture');
  }, [router]);
  return null;
}
