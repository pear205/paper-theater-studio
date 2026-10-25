import cv2, numpy as np
img=cv2.imread('src.png'); H,W=img.shape[:2]
hsv=cv2.cvtColor(img,cv2.COLOR_BGR2HSV)
h,s,v=[hsv[...,i].astype(int) for i in range(3)]
b,g,r=[img[...,i].astype(int) for i in range(3)]
# sky: blue-ish or pale cloud, flood from top-center
skyc=((h>=95)&(h<=125)&(s>25)&(v>150)) | ((s<45)&(v>200)&(b>=g-5))
skyc=skyc.astype(np.uint8)
skyc[300:]=0
n,lab=cv2.connectedComponents(skyc)
ids=set(lab[0:60,380:650].ravel())-{0}
sky=np.isin(lab,list(ids)).astype(np.uint8)
sky=cv2.morphologyEx(sky,cv2.MORPH_CLOSE,np.ones((9,9),np.uint8))
nonsky=1-sky
def poly(pts):
    m=np.zeros((H,W),np.uint8); cv2.fillPoly(m,[np.array(pts,np.int32)],1); return m
def grab(rect,fgpolys=(),bgpolys=()):
    mask=np.zeros((H,W),np.uint8); x,y,w,hh=rect
    mask[:]=cv2.GC_BGD; mask[y:y+hh,x:x+w]=cv2.GC_PR_FGD
    for p in fgpolys: mask[poly(p)==1]=cv2.GC_FGD
    for p in bgpolys: mask[poly(p)==1]=cv2.GC_BGD
    bg=np.zeros((1,65),np.float64); fg=np.zeros((1,65),np.float64)
    cv2.grabCut(img,mask,None,bg,fg,6,cv2.GC_INIT_WITH_MASK)
    return np.where((mask==1)|(mask==3),1,0).astype(np.uint8)
L={}
L[1]=np.ones((H,W),np.uint8)
L[2]=nonsky.copy(); L[2][:120]=0
L[3]=poly([(0,300),(360,298),(520,262),(600,256),(612,150),(650,118),(765,115),(785,160),(772,240),(1000,236),(1000,672),(0,672)])&nonsky
L[4]=poly([(0,345),(385,338),(405,300),(412,262),(462,262),(472,300),(520,335),(600,352),(660,345),(1000,365),(1000,672),(0,672)])
player=grab((0,240,415,432),fgpolys=[[(150,300),(370,300),(370,460),(150,460)],[(220,500),(320,500),(330,640),(220,640)],[(60,420),(180,410),(190,480),(80,500)],[(400,452),(468,452),(460,490),(405,490)]],bgpolys=[[(352,288),(420,288),(415,328),(358,328)],[(415,240),(480,240),(480,420),(415,420)],[(0,240),(140,240),(95,320),(40,375),(0,385)],[(0,520),(40,520),(40,545),(0,560)],[(372,335),(395,335),(392,420),(375,420)],[(100,505),(195,520),(195,540),(100,540)]])
deer=grab((630,280,370,392),fgpolys=[[(720,380),(900,380),(900,560),(720,560)],[(760,560),(860,560),(860,660),(760,660)],[(740,300),(770,300),(780,370),(750,370)],[(872,388),(930,380),(922,442),(882,448)]],bgpolys=[[(630,280),(728,280),(712,400),(690,470),(630,470)],[(945,300),(1000,300),(1000,555),(955,555)],[(800,280),(870,280),(860,320),(805,330)],[(928,318),(965,318),(965,362),(940,365)],[(905,475),(960,475),(960,560),(915,555)],[(876,458),(925,455),(925,548),(884,550)]])
flowers=poly([(0,560),(60,540),(140,545),(200,575),(330,575),(420,585),(500,600),(560,590),(640,600),(720,615),(1000,620),(1000,672),(0,672)])
deer=deer&(1-poly([(868,462),(930,455),(930,545),(880,540),(862,520)]))&(1-poly([(855,490),(870,488),(872,535),(858,535)]))
# remove water / bright grass that GrabCut attached to the deer
reg=np.zeros((H,W),np.uint8); reg[495:615,600:1000]=1; reg[330:410,840:960]=1
water=(h>=88)&(h<=118)&(s>90)&(v>120)
grass=(h>=30)&(h<=55)&(s>110)&(v>120)
bad=((water|grass)&(reg==1)).astype(np.uint8)
bad=cv2.dilate(bad,np.ones((3,3),np.uint8))
deer=deer&(1-bad)&(1-poly([(848,512),(908,512),(908,560),(870,562),(850,548)]))
deer=cv2.morphologyEx(deer,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7)))
n,lab,st,_=cv2.connectedComponentsWithStats(deer); big=1+np.argmax(st[1:,4]); deer=(lab==big).astype(np.uint8)
canr=poly([(598,560),(640,540),(655,520),(705,512),(728,535),(728,600),(690,612),(640,606),(598,598)])
wat2=(h>=88)&(h<=118)&(s>70)&(v>110); gr2=(h>=28)&(h<=60)&(s>90)
orng=(h<=22)&(s>80); orng[:, 705:]=False
can=(canr&(1-(wat2|gr2|orng).astype(np.uint8))).astype(np.uint8)
can=cv2.morphologyEx(can,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5)))
can=cv2.morphologyEx(can,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(9,9)))
deer=deer|can
L[5]=player|deer|flowers
corner=poly([(0,0),(350,0),(335,60),(285,125),(210,170),(175,240),(125,320),(70,370),(0,385)])|poly([(660,0),(1000,0),(1000,395),(945,375),(855,300),(830,245),(805,165),(760,90),(690,40)])
L[6]=corner&nonsky
def smooth(m,k):
    m=cv2.morphologyEx(m,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(k,k)))
    m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(k,k)))
    bl=cv2.GaussianBlur(m.astype(np.float32),(0,0),k/3)
    m=(bl>0.5).astype(np.uint8)
    # drop small islands
    n,lab,st,_=cv2.connectedComponentsWithStats(m)
    keep=np.zeros_like(m)
    for i in range(1,n):
        if st[i,4]>1500: keep[lab==i]=1
    return keep
for i in range(2,7): L[i]=smooth(L[i],9)
chars=(player|deer)
chars=smooth(chars,9)
def inp(src,m,dil):
    m=cv2.dilate(m*255,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(dil,dil)))
    return cv2.inpaint(src,m,9,cv2.INPAINT_TELEA)
base=inp(img,chars,15)          # characters removed
base2=inp(base,L[6],15)          # + corner trees removed
ys=[y for y in range(0,300) if sky[y].sum()>20]
col=np.array([img[y][sky[y]==1].mean(0) for y in ys])
grad=np.zeros_like(img,dtype=np.float32)
for y in range(H):
    yy=min(max(y,ys[0]),ys[-1]); grad[y]=col[ys.index(yy)] if yy in ys else col[-1]
grad=np.clip(grad*1.0,0,255).astype(np.uint8)
skyL=np.where(sky[...,None]==1,img,grad)
layer_src={1:skyL,2:base2,3:base2,4:base2,5:inp(img,L[6]&(1-L[5]),15),6:img}
cv2.imwrite('base2.png',base2)
# mild upscale x3 for crisp print/preview
S=2
big=cv2.resize(img,(W*S,H*S),interpolation=cv2.INTER_LANCZOS4)
for i in range(1,7):
    m=cv2.resize(L[i]*255,(W*S,H*S),interpolation=cv2.INTER_LINEAR)
    m=cv2.GaussianBlur(m,(3,3),0)
    big=cv2.resize(layer_src[i],(W*S,H*S),interpolation=cv2.INTER_LANCZOS4)
    rgba=cv2.cvtColor(big,cv2.COLOR_BGR2BGRA); rgba[...,3]=m
    cv2.imwrite(f'L{i}.png',rgba)
    cv2.imwrite(f'mask{i}.png',L[i]*255)
# contact sheet
tiles=[]
for i in range(1,7):
    t=cv2.imread(f'L{i}.png',cv2.IMREAD_UNCHANGED); t=cv2.resize(t,(500,336))
    a=t[...,3:4]/255.0; chk=np.full((336,500,3),(200,120,255),np.uint8)
    o=(t[...,:3]*a+chk*(1-a)).astype(np.uint8); cv2.putText(o,f'L{i}',(10,30),0,1,(0,0,0),2); tiles.append(o)
sheet=np.vstack([np.hstack(tiles[0:2]),np.hstack(tiles[2:4]),np.hstack(tiles[4:6])])
cv2.imwrite('sheet.png',sheet)
