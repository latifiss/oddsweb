import { NextResponse } from 'next/server';
import { apiClient } from '@/lib/api/apiFootballClient';

export async function GET() {
  const data = await apiClient.request('odds/bookmakers');
  
  return NextResponse.json({ 
    status: 200,
    count: data.response?.length || 0,
    bookmakers: data.response?.slice(0, 5) 
  });
}