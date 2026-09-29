import {it,expect,vi,afterEach} from 'vitest';
vi.mock('../../lib/prisma',()=>({prisma:{journalEntryLine:{findMany:vi.fn()}}}));
import {prisma} from '../../lib/prisma';
import {getIncomeExpenseTrend} from './dashboard.service';
import {COUNTED_ENTRY_WHERE} from '../../lib/countedEntries';
afterEach(()=>vi.useRealTimers());
it('nets reversals, fills empty months, and scopes counted activity to the tenant/company',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-29T10:00:00Z'));
 const line=(type:string,debit:number,credit:number)=>({account:{type},debit,credit,journalEntry:{date:new Date('2026-09-15')}});
 vi.mocked(prisma.journalEntryLine.findMany).mockResolvedValue([line('revenue',0,1000),line('revenue',150,0),line('expense',400,0),line('expense',0,50)] as any);
 const rows=await getIncomeExpenseTrend('t','c');
 expect(rows).toHaveLength(12);expect(rows[0]).toEqual({month:'2025-10',revenue:0,expense:0});
 expect(rows[11]).toEqual({month:'2026-09',revenue:850,expense:350});
 expect(prisma.journalEntryLine.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({account:{tenantId:'t',companyId:'c',type:{in:['revenue','expense']}},journalEntry:expect.objectContaining({tenantId:'t',companyId:'c',AND:[COUNTED_ENTRY_WHERE],date:{gte:new Date('2025-10-01'),lte:new Date('2026-09-29T10:00:00Z')}})})}));
});
