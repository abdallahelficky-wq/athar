import {expect,it,vi} from 'vitest';
vi.mock('../../lib/prisma',()=>({prisma:{account:{findMany:vi.fn()},journalEntryLine:{findMany:vi.fn()}}}));
import {prisma} from '../../lib/prisma';
import {getTrialBalanceTree} from './reports.service';
it('summary uses posting accounts once and remains complete when the tree is searched',async()=>{
 const accounts=[{id:'group',code:'1',type:'asset',isPosting:false,level:1,parentId:null},{id:'cash',code:'11',type:'asset',isPosting:true,level:2,parentId:'group'},{id:'rev',code:'4',type:'revenue',isPosting:true,level:1,parentId:null},{id:'exp',code:'5',type:'expense',isPosting:true,level:1,parentId:null}].map(a=>({...a,name:a.id,nameEn:null}));
 vi.mocked(prisma.account.findMany).mockResolvedValue(accounts as any);
 vi.mocked(prisma.journalEntryLine.findMany).mockImplementation((async(args:any)=> args.where.journalEntry.date.gte ? [{accountId:'cash',debit:300,credit:0},{accountId:'rev',debit:0,credit:500},{accountId:'exp',debit:200,credit:0}] as any : [{accountId:'cash',debit:100,credit:0}] as any) as any);
 const result=await getTrialBalanceTree('t','c',new Date('2026-01-01'),new Date('2026-09-29'),{search:'cash'});
 expect(result.summary).toEqual({assets:400,liabilities:0,equity:0,revenue:500,expense:200,netIncome:300});
 expect(result.roots).toHaveLength(1);expect(result.roots[0].type).toBe('asset');
 expect(result.totals.periodDebit).toBe(500);expect(result.totals.periodCredit).toBe(500);
});
