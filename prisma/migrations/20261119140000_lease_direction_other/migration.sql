-- عقود «أخرى» للمتابعة فقط (مثل عقد باسم شركة شقيقة)
ALTER TYPE "LeaseDirection" ADD VALUE IF NOT EXISTS 'other';
