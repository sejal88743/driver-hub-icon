-- Add line_cut_amt column to bills table
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/sgtjihrzpngktwnpihmx/sql

ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS line_cut_amt real;
