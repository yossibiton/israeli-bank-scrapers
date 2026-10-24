const test = require("node:test");
const assert = require("node:assert/strict");
const listModule = require("../runtime/isracard-pending-list.js");
const dashboardModule = require("../runtime/isracard-pending-dashboard.js");
const {scrapeIsracardPendingList}=listModule;
const {attachPendingTransactions}=dashboardModule;

function pageFixture({missingSection=false,mismatch=false,detailFailure=false,reordered=false,delayedSectionReads=0,delayedCardReads=0,delayedCardsReads=0,delayedReturnCardReads=0,resetSelectedAfterReturn=false}={}) {
  const cards=[{last4:"0001"},{last4:"0002"}], rows=[Array.from({length:8},(_,i)=>({merchant:i<2?"Repeated example":`Example ${i}`,amount:i<2?10:10+i})),[{merchant:"Other card example",amount:20}]];
  let selected=0,pendingSelected=null,pendingCardReads=0,view="list",detail=null,returns=0,reads=0,returnCardReads=0,returnCardsVisible=true;
  return {cards,rows,get selected(){return selected;},
    async goto(){if(view==="detail"){returns++;returnCardReads=0;returnCardsVisible=delayedReturnCardReads===0;if(resetSelectedAfterReturn)selected=0;}view="list";}, async waitForSelector(){},async waitForNetworkIdle(){},
    async waitForFunction(fn){if(fn.name==="isTransactionsPage")assert.equal(view,"list");else if(fn.name==="isApprovalDetailsPage")assert.equal(view,"detail");},
    async goBack(){view="list";returns++;returnCardReads=0;returnCardsVisible=delayedReturnCardReads===0;if(resetSelectedAfterReturn)selected=0;},
    async evaluate(fn,arg){
      if(fn.name==="readPendingNavigation") return {monthControls:[],pendingHeadingTags:[],roleCounts:{}};
      if(fn.name==="readPendingListPage"){
        reads++;
        if(returns&&returnCardReads<delayedReturnCardReads){returnCardReads++;returnCardsVisible=false;}else if(returns)returnCardsVisible=true;
        if(pendingSelected!==null){if(pendingCardReads++>=delayedCardReads) selected=pendingSelected;if(selected===pendingSelected)pendingSelected=null;}
        const ordered=reordered&&returns?[...rows[selected]].reverse():rows[selected];
        const visibleCards=reads<=delayedCardsReads||returns&&!returnCardsVisible?[]:cards.map((c,index)=>({...c,index,active:index===selected}));
        const sectionDelayed=reads<=delayedSectionReads;
        const headingFound=!(missingSection&&selected===1)&&!sectionDelayed;
        return {cards:visibleCards,selectedCardLast4:visibleCards.length?cards[selected].last4:null,headingFound,declaredCount:!headingFound||missingSection&&selected===1?null:ordered.length+(mismatch?1:0),paginationUnknown:!headingFound||missingSection&&selected===1||mismatch,rows:!headingFound||missingSection&&selected===1?[]:ordered.map((r,index)=>({index,spans:[r.merchant,`₪ ${r.amount}.00`,"24.10.26"]}))};
      }
      if(fn.name==="clickPendingCard"){if(returns&&!returnCardsVisible)return false;if(delayedCardReads){pendingSelected=arg;pendingCardReads=0;}else selected=arg;return true;}
      if(fn.name==="clickPendingListRow"){
        const ordered=reordered&&returns?[...rows[selected]].reverse():rows[selected];detail=ordered[arg];view="detail";return true;
      }
      if(fn.name==="readApprovalDetails"){
        if(detailFailure&&detail.merchant==="Example 3")throw new Error("synthetic detail failure");
        return {cardLast4:cards[selected].last4,fields:{"שם בית עסק":detail.merchant,"תאריך עסקה":"24.10.26","סכום מקורי":`${detail.amount}.00`,"מטבע מקורי":"ILS","סכום מוערך בש\"ח":`₪ ${detail.amount}.00`}};
      }
      throw new Error(`Unexpected callback ${fn.name}`);
    }
  };
}

test("waits for delayed initial cards and pending section before reading rows",async()=>{
  const result=await scrapeIsracardPendingList(pageFixture({delayedCardsReads:3,delayedSectionReads:4}),{enabled:true,settleMs:0,listReadyTimeoutMs:1000});
  assert.equal(result.transactions.length,9);
  assert.equal(result.coverage.listEnumerationComplete,true);
});

test("waits for a selected card to finish switching before treating its section as absent",async()=>{
  const result=await scrapeIsracardPendingList(pageFixture({delayedCardReads:3}),{enabled:true,settleMs:0,listReadyTimeoutMs:1000});
  assert.equal(result.transactions.length,9);
  assert.equal(result.coverage.cardsInspected,2);
  assert.equal(result.coverage.listEnumerationComplete,true);
});

test("waits for card controls to render after returning from approval details",async()=>{
  const result=await scrapeIsracardPendingList(pageFixture({delayedReturnCardReads:2,resetSelectedAfterReturn:true}),{enabled:true,settleMs:0,listReadyTimeoutMs:1000});
  assert.equal(result.transactions.length,9);
  assert.equal(result.coverage.cardsInspected,2);
  assert.equal(result.coverage.listEnumerationComplete,true);
  assert.equal(result.coverage.failure,null);
});

test("reads more than five pending items, all cards, and preserves identical occurrences", async()=>{
  const page=pageFixture();
  const result=await scrapeIsracardPendingList(page,{enabled:true,settleMs:0});
  assert.equal(result.transactions.length,9);
  assert.equal(result.coverage.cards[0].listedRows,8);
  assert.equal(result.coverage.cardsInspected,2);
  assert.equal(result.coverage.listEnumerationComplete,true);
  assert.equal(result.coverage.dashboardRowLimit,null);
  assert.equal(result.coverage.unresolvedRows,0);
  assert.equal(page.selected,0);
  const repeated=result.transactions.filter(r=>r.description==="Repeated example");
  assert.equal(repeated.length,2);
  assert.deepEqual(repeated.map(r=>r.rawTransaction.listOccurrence),[0,1]);
  const attached=attachPendingTransactions({accounts:[{accountNumber:"0001",txns:[]},{accountNumber:"0002",txns:[]}]},result.transactions,result.coverage);
  assert.equal(attached.accounts[0].txns.length,8);
  assert.equal(attached.accounts[1].txns.length,1);
});

test("re-resolves rows after back-navigation reorders the list",async()=>{
  const result=await scrapeIsracardPendingList(pageFixture({reordered:true}),{enabled:true,settleMs:0});
  assert.equal(result.transactions.length,9);
  assert.equal(result.coverage.unresolvedRows,0);
});

test("missing sections and count mismatch cannot establish complete enumeration",async()=>{
  const missing=await scrapeIsracardPendingList(pageFixture({missingSection:true}),{enabled:true,settleMs:0,listReadyTimeoutMs:100});
  assert.equal(missing.transactions.length,8);
  assert.equal(missing.coverage.cards[1].declaredCount,null);
  assert.equal(missing.coverage.cards[1].failure,"pending_section_absent");
  assert.equal(missing.coverage.listEnumerationComplete,false);
  const mismatch=await scrapeIsracardPendingList(pageFixture({mismatch:true}),{enabled:true,settleMs:0});
  assert.equal(mismatch.coverage.listEnumerationComplete,false);
  assert.equal(mismatch.coverage.cards[0].failure,"pending_count_not_verified");
  assert.equal(mismatch.transactions.length,0);
});

test("detail failure is counted once and does not discard other pending purchases",async()=>{
  const result=await scrapeIsracardPendingList(pageFixture({detailFailure:true}),{enabled:true,settleMs:0,detailsReadyTimeoutMs:0});
  assert.equal(result.transactions.length,8);
  assert.equal(result.coverage.inspectedRows,9);
  assert.equal(result.coverage.unresolvedRows,1);
  assert.equal(result.coverage.inspectedRows,result.transactions.length+result.coverage.unresolvedRows);
});

test("disabled collection does not touch the browser",async()=>{
  const result=await scrapeIsracardPendingList({});
  assert.equal(result.coverage.status,"disabled");
  assert.equal(result.transactions.length,0);
});
