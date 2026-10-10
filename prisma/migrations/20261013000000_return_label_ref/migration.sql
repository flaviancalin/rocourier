-- Return labels: what the courier gives once (GLS) or the id needed to print (Packeta)
ALTER TABLE "ReturnRequest" ADD COLUMN "returnLabelRef" TEXT;
