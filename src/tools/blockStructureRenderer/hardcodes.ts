import type { BlockState } from '@/tools/blockStructureRenderer/renderer.ts'
import { BlockStructure, NameMapping } from '@/tools/blockStructureRenderer/renderer.ts'
import {
  Direction,
  getDirectionFromName,
  getStepX,
  getStepZ,
  IDENTITY_ROTATION,
  isHorizontalDirection,
  isVerticalDirection,
  oppositeDirection,
  Rotation,
} from '@/tools/blockStructureRenderer/math.ts'
import {
  bakeModel,
  type BlockStateModelManager,
  renderModelNoCullsWithMS,
} from '@/tools/blockStructureRenderer/model.ts'
import {
  ANIMATED_TEXTURE_ATLAS_SIZE,
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  MaterialPicker,
} from '@/tools/blockStructureRenderer/texture.ts'
import * as THREE from 'three'
import type { ModelFace } from '@/tools/blockStructureRenderer/definitions.ts'

export function checkNameInSet(name: string, nameSet: (string | RegExp)[]) {
  return nameSet.some((nameTest) =>
    nameTest instanceof RegExp ? nameTest.test(name) : nameTest === name,
  )
}

// Subclasses of net.minecraft.world.level.block.HalfTransparentBlock
export const halfTransparentBlocks = [
  'frosted_ice',
  'ice',
  'honey_block',
  'slime_block',
  /.*copper_grate$/,
  'glass',
  /.*stained_glass$/,
  'tinted_glass',
]

// Subclasses of net.minecraft.world.level.block.LeavesBlock
export const leavesBlocks = /.*_leaves$/

// net.minecraft.world.level.block.state.BlockBehaviour
// protected boolean skipRendering(BlockState blockState, BlockState blockState2, Direction direction)
//  default: return false
//  overrides: HalfTransparentBlock, IronBarsBlock, (LiquidBlock), MangroveRootsBlock, PowderSnowBlock
export function hardCodedSkipRendering(
  thisBlock: BlockState,
  otherBlock: BlockState,
  direction: Direction,
) {
  if (thisBlock.blockName === 'powder_snow' && otherBlock.blockName === 'powder_snow') return true
  if (
    thisBlock.blockName === 'iron_bars' &&
    otherBlock.blockName === 'iron_bars' &&
    isHorizontalDirection(direction) &&
    thisBlock.blockProperties[direction] === 'true' &&
    otherBlock.blockProperties[oppositeDirection(direction)] === 'true'
  )
    return true
  if (
    thisBlock.blockName === 'mangrove_roots' &&
    otherBlock.blockName === 'mangrove_roots' &&
    isVerticalDirection(direction)
  )
    return true
  return (
    checkNameInSet(thisBlock.blockName, halfTransparentBlocks) &&
    thisBlock.blockName === otherBlock.blockName
  )
}

export function getShade(direction: Direction, shade: boolean) {
  const constantAmbientLight = false // Overworld/The End constant ambient light
  if (!shade) {
    return constantAmbientLight ? 0.9 : 1
  }
  switch (direction) {
    case Direction.DOWN:
      return constantAmbientLight ? 0.9 : 0.5
    case Direction.UP:
      return constantAmbientLight ? 0.9 : 1
    case Direction.NORTH:
    case Direction.SOUTH:
      return 0.8
    case Direction.WEST:
    case Direction.EAST:
      return 0.6
  }
}

export function resolveSpecialTextures(
  blockName: string,
  materialPicker: MaterialPicker,
  modelManager: BlockStateModelManager,
  renderType: string,
): [THREE.MeshBasicMaterial[], number[][]] {
  const specialTextureIDs = modelManager.getSpecialBlocksData(blockName)
  const resolvedMaterial = specialTextureIDs
    .map((texture) => materialPicker.atlasMapping[texture])
    .map(
      (sprite) =>
        (Array.isArray(sprite) ? materialPicker.staticTexture : materialPicker.animatedTexture)[
          renderType
        ],
    )
  const resolvedSprites = specialTextureIDs.map((texture) => {
    const sprite = materialPicker.atlasMapping[texture]
    if (Array.isArray(sprite)) {
      return [sprite[0], sprite[1], sprite[2], sprite[3], ATLAS_WIDTH, ATLAS_HEIGHT]
    } else {
      const firstFrame = materialPicker.atlasMapping[sprite.frames[0]] as number[]
      const [x, y, width, height] = materialPicker.animatedTextureManager.putNewTexture(
        texture,
        sprite,
        [firstFrame[2], firstFrame[3]],
      )
      return [x, y, width, height, ANIMATED_TEXTURE_ATLAS_SIZE, ANIMATED_TEXTURE_ATLAS_SIZE]
    }
  })
  return [resolvedMaterial, resolvedSprites]
}

export const hardCodedRenderers = [
  {
    block: 'water',
    renderFunc: () => {},
  },
  {
    block: 'lava',
    renderFunc: () => {},
  },
  {
    block: 'chest',
    renderFunc: renderChest,
  },
  {
    block: 'ender_chest',
    renderFunc: renderChest,
  },
  {
    block: 'trapped_chest',
    renderFunc: renderChest,
  },
  {
    block: /.*shulker_box$/,
    renderFunc: renderShulkerBox,
  },
  {
    block: 'lectern',
    renderFunc: renderLecternBlock,
    needRenderModel: true,
  },
  {
    block: 'enchanting_table',
    renderFunc: renderEnchantTable,
    needRenderModel: true,
  },
  {
    block: 'bell',
    renderFunc: renderBell,
    needRenderModel: true,
  },
  {
    block: 'decorated_pot',
    renderFunc: renderDecoratedPot,
  },
  {
    block: /.*_bed$/,
    renderFunc: renderBed,
  },
  {
    block: /.*_banner$/,
    renderFunc: renderBanner,
  },
  {
    block: 'piston_head', // Avoid wrongly matching
    renderFunc: () => {},
    needRenderModel: true,
  },
  {
    block: /.*_skull$/,
    renderFunc: renderSkull,
  },
  {
    block: /.*_head$/,
    renderFunc: renderSkull,
  },
  {
    block: /.*_hanging_sign$/,
    renderFunc: renderHangingSign,
  },
  {
    block: /.*_sign$/,
    renderFunc: renderSign,
  },
] as {
  block: string | RegExp
  renderFunc: (
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    blockState: BlockState,
    modelManager: BlockStateModelManager,
    materialPicker: MaterialPicker,
    nameMapping: NameMapping,
    blockStructure: BlockStructure,
  ) => void
  needRenderModel?: boolean
}[]

// net.minecraft.client.model.geom.builders.CubeListBuilder
// prettier-ignore
function boxModel(
  texture: number,
  materialPicker: MaterialPicker,
  [fromX, fromY, fromZ]: number[],
  [width, height, depth]: number[],
  [texOffX, texOffY]: number[],
  [poseOffX, poseOffY, poseOffZ]: number[] = [0, 0, 0], // Use this if you confirm no manual rotation (using matrix) is needed
  rotation: Rotation = IDENTITY_ROTATION, // Use this if you confirm no manual rotation (using matrix) is needed
  visibleFaces: Direction[] = [
    Direction.DOWN,
    Direction.UP,
    Direction.WEST,
    Direction.NORTH,
    Direction.EAST,
    Direction.SOUTH,
  ],
  mirror: boolean = false,
  shade: boolean = true,
) {
  const directionFaces = {} as Record<Direction, ModelFace>
  if (mirror) {
    if (visibleFaces.includes(Direction.DOWN))
      directionFaces[Direction.DOWN] = {
        texture,
        uv: [texOffX + depth + width, texOffY, texOffX + depth, texOffY + depth],
      }
    if (visibleFaces.includes(Direction.UP))
      directionFaces[Direction.UP] = {
        texture,
        uv: [texOffX + depth + width, texOffY, texOffX + depth + width + width, texOffY + depth],
        rotation: 180,
      }
    if (visibleFaces.includes(Direction.WEST))
      directionFaces[Direction.WEST] = {
        texture,
        uv: [texOffX + depth, texOffY + depth + height, texOffX, texOffY + depth],
      }
    if (visibleFaces.includes(Direction.NORTH))
      directionFaces[Direction.NORTH] = {
        texture,
        uv: [texOffX + depth, texOffY + depth + height, texOffX + depth + width, texOffY + depth],
      }
    if (visibleFaces.includes(Direction.EAST))
      directionFaces[Direction.EAST] = {
        texture,
        uv: [
          texOffX + depth + width + depth,
          texOffY + depth + height,
          texOffX + depth + width,
          texOffY + depth,
        ],
      }
    if (visibleFaces.includes(Direction.SOUTH))
      directionFaces[Direction.SOUTH] = {
        texture,
        uv: [
          texOffX + depth + width + depth,
          texOffY + depth + height,
          texOffX + depth + width + depth + width,
          texOffY + depth,
        ],
      }
  } else {
    if (visibleFaces.includes(Direction.DOWN))
      directionFaces[Direction.DOWN] = {
        texture,
        uv: [texOffX + depth, texOffY, texOffX + depth + width, texOffY + depth],
      }
    if (visibleFaces.includes(Direction.UP))
      directionFaces[Direction.UP] = {
        texture,
        uv: [texOffX + depth + width + width, texOffY, texOffX + depth + width, texOffY + depth],
        rotation: 180,
      }
    if (visibleFaces.includes(Direction.WEST))
      directionFaces[Direction.WEST] = {
        texture,
        uv: [texOffX + depth, texOffY + depth + height, texOffX, texOffY + depth],
      }
    if (visibleFaces.includes(Direction.NORTH))
      directionFaces[Direction.NORTH] = {
        texture,
        uv: [texOffX + depth + width, texOffY + depth + height, texOffX + depth, texOffY + depth],
      }
    if (visibleFaces.includes(Direction.EAST))
      directionFaces[Direction.EAST] = {
        texture,
        uv: [
          texOffX + depth + width + depth,
          texOffY + depth + height,
          texOffX + depth + width,
          texOffY + depth,
        ],
      }
    if (visibleFaces.includes(Direction.SOUTH))
      directionFaces[Direction.SOUTH] = {
        texture,
        uv: [
          texOffX + depth + width + depth + width,
          texOffY + depth + height,
          texOffX + depth + width + depth,
          texOffY + depth,
        ],
      }
  }

  return bakeModel(
    materialPicker,
    {
      elements: [
        {
          from: [fromX + poseOffX, fromY + poseOffY, fromZ + poseOffZ],
          to: [fromX + width + poseOffX, fromY + height + poseOffY, fromZ + depth + poseOffZ],
          shade,
          faces: directionFaces,
        },
      ],
    },
    rotation,
    false,
  )
}

function fromFacingToRotation(facing: string) {
  switch (facing) {
    case 'south':
      return new Rotation(0, 0)
    case 'west':
      return new Rotation(0, 90)
    case 'north':
      return new Rotation(0, 180)
    case 'east':
      return new Rotation(0, 270)
  }
  return new Rotation(0, 0)
}

// net.minecraft.client.renderer.blockentity.ChestRenderer
function renderChest(
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number,
  blockState: BlockState,
  modelManager: BlockStateModelManager,
  materialPicker: MaterialPicker,
) {
  const specials = modelManager.getSpecialBlocksData(blockState.blockName)
  const normalTexture = specials[0]
  const leftTexture = specials[1]
  const rightTexture = specials[2]
  const facing = blockState.blockProperties['facing']
  const rotation = fromFacingToRotation(facing)

  let modelBottom
  let modelLid
  let modelLock
  if (blockState.blockProperties['type'] == 'single') {
    modelBottom = boxModel(
      normalTexture,
      materialPicker,
      [1, 0, 1],
      [14, 10, 14],
      [0, 19],
      [0, 0, 0],
      rotation!,
    )
    modelLid = boxModel(
      normalTexture,
      materialPicker,
      [1, 0, 0],
      [14, 5, 14],
      [0, 0],
      [0, 9, 1],
      rotation!,
    )
    modelLock = boxModel(
      normalTexture,
      materialPicker,
      [7, -2, 14],
      [2, 4, 1],
      [0, 0],
      [0, 9, 1],
      rotation!,
    )
  } else if (blockState.blockProperties['type'] == 'left') {
    modelBottom = boxModel(
      leftTexture,
      materialPicker,
      [0, 0, 1],
      [15, 10, 14],
      [0, 19],
      [0, 0, 0],
      rotation!,
    )
    modelLid = boxModel(
      leftTexture,
      materialPicker,
      [0, 0, 0],
      [15, 5, 14],
      [0, 0],
      [0, 9, 1],
      rotation!,
    )
    modelLock = boxModel(
      leftTexture,
      materialPicker,
      [0, -2, 14],
      [1, 4, 1],
      [0, 0],
      [0, 9, 1],
      rotation!,
    )
  } else if (blockState.blockProperties['type'] == 'right') {
    modelBottom = boxModel(
      rightTexture,
      materialPicker,
      [1, 0, 1],
      [15, 10, 14],
      [0, 19],
      [0, 0, 0],
      rotation!,
    )
    modelLid = boxModel(
      rightTexture,
      materialPicker,
      [1, 0, 0],
      [15, 5, 14],
      [0, 0],
      [0, 9, 1],
      rotation!,
    )
    modelLock = boxModel(
      rightTexture,
      materialPicker,
      [15, -2, 14],
      [1, 4, 1],
      [0, 0],
      [0, 9, 1],
      rotation!,
    )
  } else {
    console.warn('Unknown chest type', blockState.blockProperties['type'])
    return
  }

  const transform = new THREE.Matrix4().makeTranslation(x, y, z)
  const material = (animated: boolean) =>
    animated ? materialPicker.animatedTexture.cutout : materialPicker.staticTexture.cutout
  renderModelNoCullsWithMS(modelBottom!, blockState, material, scene, transform)
  renderModelNoCullsWithMS(modelLid!, blockState, material, scene, transform)
  renderModelNoCullsWithMS(modelLock!, blockState, material, scene, transform)
}

// net.minecraft.client.renderer.blockentity.ShulkerBoxRenderer
function renderShulkerBox(
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number,
  blockState: BlockState,
  modelManager: BlockStateModelManager,
  materialPicker: MaterialPicker,
) {
  const texture = modelManager.getSpecialBlocksData(blockState.blockName)[0]
  const facing = blockState.blockProperties['facing']
  let rotation = IDENTITY_ROTATION
  let move = [0.5, -0.5, 0.5]
  switch (facing) {
    case 'up':
      rotation = new Rotation(180, 0)
      move = [0.5, 0.5, -0.5]
      break
    case 'north':
      rotation = new Rotation(-90, 0)
      move = [0.5, -0.5, -0.5]
      break
    case 'south':
      rotation = new Rotation(90, 0)
      move = [0.5, 0.5, 0.5]
      break
    case 'west':
      rotation = new Rotation(-90, -90)
      move = [-0.5, -0.5, -0.5]
      break
    case 'east':
      rotation = new Rotation(-90, 90)
      break
  }

  const modelLid = boxModel(
    texture,
    materialPicker,
    [-8, -16, -8],
    [16, 12, 16],
    [0, 0],
    [0, 24, 0],
    rotation,
  )
  const modelBase = boxModel(
    texture,
    materialPicker,
    [-8, -8, -8],
    [16, 8, 16],
    [0, 28],
    [0, 24, 0],
    rotation,
  )

  const transform = new THREE.Matrix4().makeTranslation(x + move[0], y + move[1], z + move[2])
  const material = (animated: boolean) =>
    animated ? materialPicker.animatedTexture.cutout : materialPicker.staticTexture.cutout
  renderModelNoCullsWithMS(modelLid!, blockState, material, scene, transform)
  renderModelNoCullsWithMS(modelBase!, blockState, material, scene, transform)
}

// net.minecraft.client.model.BookModel
// prettier-ignore
function renderBook(
  scene: THREE.Scene,
  transform: THREE.Matrix4,
  block: BlockState,
  texture: number,
  materialPicker: MaterialPicker,
  [rotAngle, openScale, flipPage1Percent, flipPage2Percent]: number[],
) {
  const modelLeftLid = boxModel(texture, materialPicker, [-6, -5, -0.005], [6, 10, 0.005], [0, 0])
  const modelRightLid = boxModel(texture, materialPicker, [0, -5, -0.005], [6, 10, 0.005], [16, 0])
  const modelSeam = boxModel(texture, materialPicker, [-1, -5, 0], [2, 10, 0.005], [12, 0])
  const modelLeftPages = boxModel(texture, materialPicker, [0, -4, -0.99], [5, 8, 1], [0, 10])
  const modelRightPages = boxModel(texture, materialPicker, [0, -4, -0.01], [5, 8, 1], [12, 10])
  const modelFlipPage = boxModel(texture, materialPicker, [0, -4, 0], [5, 8, 0.005], [24, 10])

  const rot = (Math.sin(rotAngle * 0.02) * 0.1 + 1.25) * openScale
  const leftLidMatrix = new THREE.Matrix4()
    .multiply(new THREE.Matrix4().makeTranslation(0, 0, -1 / 16))
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI + rot))
  const rightLidMatrix = new THREE.Matrix4()
    .multiply(new THREE.Matrix4().makeTranslation(0, 0, 1 / 16))
    .multiply(new THREE.Matrix4().makeRotationY(-rot))
  const leftPagesMatrix = new THREE.Matrix4()
    .multiply(new THREE.Matrix4().makeTranslation(Math.sin(rot) / 16, 0, 0))
    .multiply(new THREE.Matrix4().makeRotationY(rot))
  const rightPagesMatrix = new THREE.Matrix4()
    .multiply(new THREE.Matrix4().makeTranslation(Math.sin(rot) / 16, 0, 0))
    .multiply(new THREE.Matrix4().makeRotationY(-rot))
  const flipPage1Matrix = new THREE.Matrix4()
    .multiply(new THREE.Matrix4().makeTranslation(Math.sin(rot) / 16, 0, 0))
    .multiply(new THREE.Matrix4().makeRotationY(rot - rot * 2 * flipPage1Percent))
  const flipPage2Matrix = new THREE.Matrix4()
    .multiply(new THREE.Matrix4().makeTranslation(Math.sin(rot) / 16, 0, 0))
    .multiply(new THREE.Matrix4().makeRotationY(rot - rot * 2 * flipPage2Percent))
  const seamMatrix = new THREE.Matrix4().makeRotationY(Math.PI / 2)

  const material = (animated: boolean) =>
    animated ? materialPicker.animatedTexture.solid : materialPicker.staticTexture.solid
  renderModelNoCullsWithMS(modelLeftLid, block, material, scene, transform.clone().multiply(leftLidMatrix), true)
  renderModelNoCullsWithMS(modelRightLid, block, material, scene, transform.clone().multiply(rightLidMatrix), true)
  renderModelNoCullsWithMS(modelSeam, block, material, scene, transform.clone().multiply(seamMatrix), true)
  renderModelNoCullsWithMS(modelLeftPages, block, material, scene, transform.clone().multiply(leftPagesMatrix), true)
  renderModelNoCullsWithMS(modelRightPages, block, material, scene, transform.clone().multiply(rightPagesMatrix), true)
  renderModelNoCullsWithMS(modelFlipPage, block, material, scene, transform.clone().multiply(flipPage1Matrix), true)
  renderModelNoCullsWithMS(modelFlipPage, block, material, scene, transform.clone().multiply(flipPage2Matrix), true)
}

// net.minecraft.client.renderer.blockentity.LecternRenderer
function renderLecternBlock(
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number,
  blockState: BlockState,
  modelManager: BlockStateModelManager,
  materialPicker: MaterialPicker,
) {
  if (blockState.blockProperties['has_book'] === 'false') return
  const texture = modelManager.getSpecialBlocksData(blockState.blockName)[0]
  const rotation = fromFacingToRotation(blockState.blockProperties['facing'])
  const transform = new THREE.Matrix4()
    .multiply(new THREE.Matrix4().makeTranslation(x, y, z))
    .multiply(new THREE.Matrix4().makeTranslation(0.5, 1.0625, 0.5))
    .multiply(new THREE.Matrix4().makeRotationY((-(rotation.y + 90) / 180) * Math.PI))
    .multiply(new THREE.Matrix4().makeRotationZ(Math.PI * 0.375))
    .multiply(new THREE.Matrix4().makeTranslation(0, -0.125, 0))
  renderBook(scene, transform, blockState, texture, materialPicker, [0, 1.2, 0.1, 0.9])
}

// net.minecraft.client.renderer.blockentity.EnchantTableRenderer
function renderEnchantTable(
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number,
  blockState: BlockState,
  modelManager: BlockStateModelManager,
  materialPicker: MaterialPicker,
) {
  const texture = modelManager.getSpecialBlocksData(blockState.blockName)[0]
  const time = 0
  const rotation = 0
  const transform = new THREE.Matrix4()
    .multiply(new THREE.Matrix4().makeTranslation(x, y, z))
    .multiply(new THREE.Matrix4().makeTranslation(0.5, 0.75, 0.5))
    .multiply(new THREE.Matrix4().makeTranslation(0, 0.1 + Math.sin(time * 0.1) * 0.01, 0))
    .multiply(new THREE.Matrix4().makeRotationY(-rotation))
    .multiply(new THREE.Matrix4().makeRotationZ((4 * Math.PI) / 9))
  renderBook(scene, transform, blockState, texture, materialPicker, [0, 0, 0, 0])
}

// net.minecraft.client.renderer.blockentity.BellRenderer
function renderBell(
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number,
  blockState: BlockState,
  modelManager: BlockStateModelManager,
  materialPicker: MaterialPicker,
) {
  const texture = modelManager.getSpecialBlocksData(blockState.blockName)[0]
  const rotation = fromFacingToRotation(blockState.blockProperties['facing'])

  const modelBellBody = boxModel(
    texture,
    materialPicker,
    [-3, -6, -3],
    [6, 7, 6],
    [0, 0],
    [8, 12, 8],
    rotation,
  )
  const modelBellBase = boxModel(
    texture,
    materialPicker,
    [4, 4, 4],
    [8, 2, 8],
    [0, 13],
    [0, 0, 0],
    rotation,
  )

  const transform = new THREE.Matrix4().makeTranslation(x, y, z)
  const material = (animated: boolean) =>
    animated ? materialPicker.animatedTexture.solid : materialPicker.staticTexture.solid
  renderModelNoCullsWithMS(modelBellBody, blockState, material, scene, transform)
  renderModelNoCullsWithMS(modelBellBase, blockState, material, scene, transform)
}

// net.minecraft.client.renderer.blockentity.DecoratedPotRenderer
// prettier-ignore
function renderDecoratedPot(
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number,
  blockState: BlockState,
  modelManager: BlockStateModelManager,
  materialPicker: MaterialPicker,
) {
  const [base, side] = modelManager.getSpecialBlocksData(blockState.blockName)
  const rotation = fromFacingToRotation(blockState.blockProperties['facing'])

  const modelNeck1 = boxModel(base, materialPicker, [4, 17, 4], [8, 3, 8], [0, 0])
  const modelNeck2 = boxModel(base, materialPicker, [5, 20, 5], [6, 1, 6], [0, 5])
  const modelTopBottom = boxModel(base, materialPicker, [0, 0, 0], [14, 0, 14], [-14, 13])
  const modelSide = boxModel(
    side,
    materialPicker,
    [0, 0, 0],
    [14, 16, 0],
    [1, 0],
    [0, 0, 0],
    IDENTITY_ROTATION,
    [Direction.NORTH],
  )

  const matrix = new THREE.Matrix4()
    .multiply(new THREE.Matrix4().makeTranslation(x, y, z))
    .multiply(new THREE.Matrix4().makeTranslation(0.5, 0, 0.5))
    .multiply(new THREE.Matrix4().makeRotationY((1 - rotation.y / 180) * Math.PI))
    .multiply(new THREE.Matrix4().makeTranslation(-0.5, 0, -0.5))
  const neckMatrix = new THREE.Matrix4()
    .multiply(matrix)
    .multiply(new THREE.Matrix4().makeTranslation(0, 37 / 16, 16 / 16))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI))
  const neck1Matrix = new THREE.Matrix4()
    .multiply(neckMatrix)
    .multiply(new THREE.Matrix4().makeTranslation(8 / 16, 18.5 / 16, 8 / 16))
    .multiply(new THREE.Matrix4().scale(new THREE.Vector3(78 / 80, 28 / 30, 78 / 80)))
    .multiply(new THREE.Matrix4().makeTranslation(-8 / 16, -18.5 / 16, -8 / 16))
  const neck2Matrix = new THREE.Matrix4()
    .multiply(neckMatrix)
    .multiply(new THREE.Matrix4().makeTranslation(8 / 16, 20.5 / 16, 8 / 16))
    .multiply(new THREE.Matrix4().scale(new THREE.Vector3(64 / 60, 14 / 10, 64 / 60)))
    .multiply(new THREE.Matrix4().makeTranslation(-8 / 16, -20.5 / 16, -8 / 16))
  const topMatrix = new THREE.Matrix4()
    .multiply(matrix)
    .multiply(new THREE.Matrix4().makeTranslation(1 / 16, 1, 1 / 16))
  const botMatrix = new THREE.Matrix4()
    .multiply(matrix)
    .multiply(new THREE.Matrix4().makeTranslation(1 / 16, 0, 1 / 16))
  const backMatrix = new THREE.Matrix4()
    .multiply(matrix)
    .multiply(new THREE.Matrix4().makeTranslation(15 / 16, 16 / 16, 1 / 16))
    .multiply(new THREE.Matrix4().makeRotationZ(Math.PI))
  const leftMatrix = new THREE.Matrix4()
    .multiply(matrix)
    .multiply(new THREE.Matrix4().makeTranslation(1 / 16, 16 / 16, 1 / 16))
    .multiply(new THREE.Matrix4().makeRotationZ(Math.PI))
    .multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2))
  const rightMatrix = new THREE.Matrix4()
    .multiply(matrix)
    .multiply(new THREE.Matrix4().makeTranslation(15 / 16, 16 / 16, 15 / 16))
    .multiply(new THREE.Matrix4().makeRotationZ(Math.PI))
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))
  const frontMatrix = new THREE.Matrix4()
    .multiply(matrix)
    .multiply(new THREE.Matrix4().makeTranslation(1 / 16, 16 / 16, 15 / 16))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI))

  const material = (animated: boolean) =>
    animated ? materialPicker.animatedTexture.solid : materialPicker.staticTexture.solid
  renderModelNoCullsWithMS(modelNeck1, blockState, material, scene, neck1Matrix, true)
  renderModelNoCullsWithMS(modelNeck2, blockState, material, scene, neck2Matrix, true)
  renderModelNoCullsWithMS(modelTopBottom, blockState, material, scene, topMatrix, true)
  renderModelNoCullsWithMS(modelTopBottom, blockState, material, scene, botMatrix, true)
  renderModelNoCullsWithMS(modelSide, blockState, material, scene, backMatrix, true)
  renderModelNoCullsWithMS(modelSide, blockState, material, scene, leftMatrix, true)
  renderModelNoCullsWithMS(modelSide, blockState, material, scene, rightMatrix, true)
  renderModelNoCullsWithMS(modelSide, blockState, material, scene, frontMatrix, true)
}

function renderBed(
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number,
  blockState: BlockState,
  modelManager: BlockStateModelManager,
  materialPicker: MaterialPicker,
) {
  const texture = modelManager.getSpecialBlocksData(blockState.blockName)[0]
  const rotation = fromFacingToRotation(blockState.blockProperties['facing'])

  let main
  let left
  let right
  let leftMatrixRaw
  let rightMatrixRaw
  if (blockState.blockProperties['part'] === 'head') {
    main = boxModel(texture, materialPicker, [0, 0, 0], [16, 16, 6], [0, 0])
    left = boxModel(texture, materialPicker, [0, 6, 0], [3, 3, 3], [50, 6])
    right = boxModel(texture, materialPicker, [-16, 6, 0], [3, 3, 3], [50, 6])
    leftMatrixRaw = new THREE.Matrix4()
      .multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    rightMatrixRaw = new THREE.Matrix4()
      .multiply(new THREE.Matrix4().makeRotationZ(Math.PI))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
  } else if (blockState.blockProperties['part'] === 'foot') {
    main = boxModel(texture, materialPicker, [0, 0, 0], [16, 16, 6], [0, 22])
    left = boxModel(texture, materialPicker, [0, 6, -16], [3, 3, 3], [50, 0])
    right = boxModel(texture, materialPicker, [-16, 6, -16], [3, 3, 3], [50, 12])
    leftMatrixRaw = new THREE.Matrix4().multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    rightMatrixRaw = new THREE.Matrix4()
      .multiply(new THREE.Matrix4().makeRotationZ((Math.PI * 3) / 2))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
  } else {
    console.warn('Unknown bed part', blockState.blockProperties['part'])
    return
  }

  const matrix = new THREE.Matrix4()
    .multiply(new THREE.Matrix4().makeTranslation(x, y, z))
    .multiply(new THREE.Matrix4().makeTranslation(0, 0.5625, 0))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    .multiply(new THREE.Matrix4().makeTranslation(0.5, 0.5, 0.5))
    .multiply(new THREE.Matrix4().makeRotationZ((rotation.y / 180 + 1) * Math.PI))
    .multiply(new THREE.Matrix4().makeTranslation(-0.5, -0.5, -0.5))
  const leftMatrix = new THREE.Matrix4().multiply(matrix).multiply(leftMatrixRaw)
  const rightMatrix = new THREE.Matrix4().multiply(matrix).multiply(rightMatrixRaw)
  const material = (animated: boolean) =>
    animated ? materialPicker.animatedTexture.solid : materialPicker.staticTexture.solid

  renderModelNoCullsWithMS(main, blockState, material, scene, matrix, true)
  renderModelNoCullsWithMS(left, blockState, material, scene, leftMatrix, true)
  renderModelNoCullsWithMS(right, blockState, material, scene, rightMatrix, true)
}

const dyeColorMapping = {
  white: 0xf9fffe,
  orange: 0xf9801d,
  magenta: 0xc74ebd,
  light_blue: 0x3ab3da,
  yellow: 0xfed83d,
  lime: 0x80c71f,
  pink: 0xf38baa,
  gray: 0x474f52,
  light_gray: 0x9d9d97,
  cyan: 0x169c9c,
  purple: 0x8932b8,
  blue: 0x3c44aa,
  brown: 0x835432,
  green: 0x5e7c16,
  red: 0xb02e26,
  black: 0x1d1d21,
} as Record<string, number>

function renderBanner(
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number,
  blockState: BlockState,
  modelManager: BlockStateModelManager,
  materialPicker: MaterialPicker,
) {
  const texture = modelManager.getSpecialBlocksData(blockState.blockName)[0]

  const modelFlag = boxModel(texture, materialPicker, [-10, 0, -2], [20, 40, 1], [0, 0])
  const modelPole = boxModel(texture, materialPicker, [-1, -30, -1], [2, 42, 2], [44, 0])
  const modelBar = boxModel(texture, materialPicker, [-10, -32, -1], [20, 2, 2], [0, 42])

  const time = 0
  const blockName = blockState.blockName
  const matrixBase = new THREE.Matrix4().makeTranslation(x, y, z)
  let poleVisible
  if (blockName.endsWith('_wall_banner')) {
    poleVisible = false
    const rotation = fromFacingToRotation(blockState.blockProperties['facing'])
    matrixBase
      .multiply(new THREE.Matrix4().makeTranslation(0.5, -1 / 6, 0.5))
      .multiply(new THREE.Matrix4().makeRotationY((-rotation.y / 180) * Math.PI))
      .multiply(new THREE.Matrix4().makeTranslation(0, -0.3125, -0.4375))
  } else {
    poleVisible = true
    const rotation = parseInt(blockState.blockProperties['rotation'])
    matrixBase
      .multiply(new THREE.Matrix4().makeTranslation(0.5, 0.5, 0.5))
      .multiply(new THREE.Matrix4().makeRotationY((-rotation / 8) * Math.PI))
  }
  matrixBase.multiply(new THREE.Matrix4().makeScale(2 / 3, -2 / 3, -2 / 3))

  const material = (animated: boolean) =>
    animated ? materialPicker.animatedTexture.solid : materialPicker.staticTexture.solid
  if (poleVisible)
    renderModelNoCullsWithMS(modelPole, blockState, material, scene, matrixBase, true)
  renderModelNoCullsWithMS(modelBar, blockState, material, scene, matrixBase, true)

  const wind = ((x * 7 + y * 9 + z * 13 + time) % 100) / 100
  const angle = Math.PI * (-0.0125 + 0.01 * Math.cos(Math.PI * 2 * wind))
  const flagMatrix = new THREE.Matrix4()
    .multiply(matrixBase)
    .multiply(new THREE.Matrix4().makeTranslation(0, -32 / 16, 0))
    .multiply(new THREE.Matrix4().makeRotationX(angle))
  const dyeColor = dyeColorMapping[blockName.substring(0, blockName.indexOf('_'))]
  const flagMaterial = (animated: boolean) => {
    const material = animated
      ? materialPicker.animatedTexture.solid
      : materialPicker.staticTexture.solid
    const materialClone = material.clone()
    materialClone.color.set(dyeColor)
    materialClone.side = THREE.DoubleSide
    return materialClone
  }
  renderModelNoCullsWithMS(modelFlag, blockState, flagMaterial, scene, flagMatrix, true)
}

function renderPlainSkull(
  scene: THREE.Scene,
  blockState: BlockState,
  texture: number,
  materialPicker: MaterialPicker,
  material: (animated: boolean) => THREE.MeshBasicMaterial,
  transform: THREE.Matrix4,
  rotation: number,
) {
  const modelHead = boxModel(texture, materialPicker, [-4, -8, -4], [8, 8, 8], [0, 0])
  const matrix = new THREE.Matrix4()
    .multiply(transform)
    .multiply(new THREE.Matrix4().makeRotationY(rotation))
  renderModelNoCullsWithMS(modelHead, blockState, material, scene, matrix, true)
}

function renderDragonHead(
  scene: THREE.Scene,
  blockState: BlockState,
  texture: number,
  materialPicker: MaterialPicker,
  material: (animated: boolean) => THREE.MeshBasicMaterial,
  transform: THREE.Matrix4,
  rotation: number,
) {
  const modelUpperLip = boxModel(texture, materialPicker, [-6, -1, -24], [12, 5, 16], [176, 44])
  const modelUpperHead = boxModel(texture, materialPicker, [-8, -8, -10], [16, 16, 16], [112, 30])
  const modelScale = boxModel(
    texture,
    materialPicker,
    [-5, -12, -4],
    [2, 4, 6],
    [0, 0],
    [0, 0, 0],
    IDENTITY_ROTATION,
    [
      Direction.NORTH,
      Direction.SOUTH,
      Direction.WEST,
      Direction.EAST,
      Direction.UP,
      Direction.DOWN,
    ],
    true,
  )
  const modelNoStril = boxModel(
    texture,
    materialPicker,
    [-5, -3, -22],
    [2, 2, 4],
    [112, 0],
    [0, 0, 0],
    IDENTITY_ROTATION,
    [
      Direction.NORTH,
      Direction.SOUTH,
      Direction.WEST,
      Direction.EAST,
      Direction.UP,
      Direction.DOWN,
    ],
    true,
  )
  const modelScale2 = boxModel(texture, materialPicker, [3, -12, -4], [2, 4, 6], [0, 0])
  const modelNoStril2 = boxModel(texture, materialPicker, [3, -3, -22], [2, 2, 4], [112, 0])
  const modelJaw = boxModel(texture, materialPicker, [-6, 0, -16], [12, 4, 16], [176, 65])

  const headMatrix = new THREE.Matrix4()
    .multiply(transform)
    .multiply(new THREE.Matrix4().makeTranslation(0, -0.374375, 0))
    .multiply(new THREE.Matrix4().makeScale(0.75, 0.75, 0.75))
    .multiply(new THREE.Matrix4().makeRotationY(rotation))
  const jawMatrix = new THREE.Matrix4()
    .multiply(headMatrix)
    .multiply(new THREE.Matrix4().makeTranslation(0, 4 / 16, -8 / 16))
    .multiply(new THREE.Matrix4().makeRotationX(0.2))

  renderModelNoCullsWithMS(modelUpperLip, blockState, material, scene, headMatrix, true)
  renderModelNoCullsWithMS(modelUpperHead, blockState, material, scene, headMatrix, true)
  renderModelNoCullsWithMS(modelScale, blockState, material, scene, headMatrix, true)
  renderModelNoCullsWithMS(modelNoStril, blockState, material, scene, headMatrix, true)
  renderModelNoCullsWithMS(modelScale2, blockState, material, scene, headMatrix, true)
  renderModelNoCullsWithMS(modelNoStril2, blockState, material, scene, headMatrix, true)
  renderModelNoCullsWithMS(modelJaw, blockState, material, scene, jawMatrix, true)
}

function renderPiglinHead(
  scene: THREE.Scene,
  blockState: BlockState,
  texture: number,
  materialPicker: MaterialPicker,
  material: (animated: boolean) => THREE.MeshBasicMaterial,
  transform: THREE.Matrix4,
  rotation: number,
) {
  const modelHead1 = boxModel(texture, materialPicker, [-5, -8, -4], [10, 8, 8], [0, 0])
  const modelHead2 = boxModel(texture, materialPicker, [-2, -4, -5], [4, 4, 1], [31, 1])
  const modelHead3 = boxModel(texture, materialPicker, [2, -2, -5], [1, 2, 1], [2, 4])
  const modelHead4 = boxModel(texture, materialPicker, [-3, -2, -5], [1, 2, 1], [2, 0])
  const modelLeftEar = boxModel(texture, materialPicker, [0, 0, -2], [1, 5, 4], [51, 6])
  const modelRightEar = boxModel(texture, materialPicker, [-1, 0, -2], [1, 5, 4], [39, 6])

  const headMatrix = new THREE.Matrix4()
    .multiply(transform)
    .multiply(new THREE.Matrix4().makeRotationY(rotation))
  const leftEarMatrix = new THREE.Matrix4()
    .multiply(headMatrix)
    .multiply(new THREE.Matrix4().makeTranslation(4.5 / 16, -6 / 16, 0))
    .multiply(new THREE.Matrix4().makeRotationZ(-0.5))
  const rightEarMatrix = new THREE.Matrix4()
    .multiply(headMatrix)
    .multiply(new THREE.Matrix4().makeTranslation(-4.5 / 16, -6 / 16, 0))
    .multiply(new THREE.Matrix4().makeRotationZ(0.5))

  renderModelNoCullsWithMS(modelHead1, blockState, material, scene, headMatrix, true)
  renderModelNoCullsWithMS(modelHead2, blockState, material, scene, headMatrix, true)
  renderModelNoCullsWithMS(modelHead3, blockState, material, scene, headMatrix, true)
  renderModelNoCullsWithMS(modelHead4, blockState, material, scene, headMatrix, true)
  renderModelNoCullsWithMS(modelLeftEar, blockState, material, scene, leftEarMatrix, true)
  renderModelNoCullsWithMS(modelRightEar, blockState, material, scene, rightEarMatrix, true)
}

function renderSkull(
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number,
  blockState: BlockState,
  modelManager: BlockStateModelManager,
  materialPicker: MaterialPicker,
) {
  const texture = modelManager.getSpecialBlocksData(blockState.blockName)[0]

  const matrix = new THREE.Matrix4().makeTranslation(x, y, z)
  let rot
  if (blockState.blockName.includes('wall')) {
    const direction = getDirectionFromName(blockState.blockProperties['facing'])
    const rotation = fromFacingToRotation(blockState.blockProperties['facing'])
    matrix
      .multiply(
        new THREE.Matrix4().makeTranslation(
          0.5 - getStepX(direction) * 0.25,
          0.25,
          0.5 - getStepZ(direction) * 0.25,
        ),
      )
      .multiply(new THREE.Matrix4().makeScale(-1, -1, 1))
    rot = (1 - rotation.y / 180) * Math.PI
  } else {
    const rotation = parseInt(blockState.blockProperties['rotation'])
    matrix
      .multiply(new THREE.Matrix4().makeTranslation(0.5, 0, 0.5))
      .multiply(new THREE.Matrix4().makeScale(-1, -1, 1))
    rot = (rotation / 8) * Math.PI
  }

  const material = blockState.blockName.includes('player')
    ? (animated: boolean) =>
        animated
          ? materialPicker.animatedTexture.translucent
          : materialPicker.staticTexture.translucent
    : (animated: boolean) => {
        const material = animated
          ? materialPicker.animatedTexture.cutout
          : materialPicker.staticTexture.cutout
        const materialClone = material.clone()
        materialClone.side = THREE.DoubleSide
        return materialClone
      }

  if (blockState.blockName.includes('dragon')) {
    renderDragonHead(scene, blockState, texture, materialPicker, material, matrix, rot)
  } else if (blockState.blockName.includes('piglin')) {
    renderPiglinHead(scene, blockState, texture, materialPicker, material, matrix, rot)
  } else {
    renderPlainSkull(scene, blockState, texture, materialPicker, material, matrix, rot)
  }
}

function renderSign(
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number,
  blockState: BlockState,
  modelManager: BlockStateModelManager,
  materialPicker: MaterialPicker,
) {
  const texture = modelManager.getSpecialBlocksData(blockState.blockName)[0]

  const modelSign = boxModel(texture, materialPicker, [-12, -14, -1], [24, 12, 2], [0, 0])
  const modelStick = boxModel(texture, materialPicker, [-1, -2, -1], [2, 14, 2], [0, 14])

  const transform = new THREE.Matrix4().makeTranslation(x, y, z)
  if (blockState.blockName.includes('wall')) {
    const rotation = fromFacingToRotation(blockState.blockProperties['facing'])
    transform
      .multiply(new THREE.Matrix4().makeTranslation(0.5, 0.5, 0.5))
      .multiply(new THREE.Matrix4().makeRotationY((rotation.y / 180) * Math.PI))
      .multiply(new THREE.Matrix4().makeTranslation(0, -0.3125, -0.4375))
  } else {
    const rotation = parseInt(blockState.blockProperties['rotation'])
    transform
      .multiply(new THREE.Matrix4().makeTranslation(0.5, 0.5, 0.5))
      .multiply(new THREE.Matrix4().makeRotationY((-rotation / 8) * Math.PI))
  }
  transform.multiply(new THREE.Matrix4().makeScale(2 / 3, -2 / 3, -2 / 3))

  const material = (animated: boolean) => {
    const material = animated
      ? materialPicker.animatedTexture.cutout
      : materialPicker.staticTexture.cutout
    const materialClone = material.clone()
    materialClone.side = THREE.DoubleSide
    return materialClone
  }
  renderModelNoCullsWithMS(modelSign, blockState, material, scene, transform, true)
  if (!blockState.blockName.includes('wall'))
    renderModelNoCullsWithMS(modelStick, blockState, material, scene, transform, true)
}

function renderHangingSign(
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number,
  blockState: BlockState,
  modelManager: BlockStateModelManager,
  materialPicker: MaterialPicker,
) {
  const texture = modelManager.getSpecialBlocksData(blockState.blockName)[0]

  const modelBoard = boxModel(texture, materialPicker, [-7, 0, -1], [14, 10, 2], [0, 12])
  const modelPlank = boxModel(texture, materialPicker, [-8, -6, -2], [16, 2, 4], [0, 0])
  const modelChain1 = boxModel(texture, materialPicker, [-1.5, 0, 0], [3, 6, 0], [0, 6])
  const modelChain2 = boxModel(texture, materialPicker, [-1.5, 0, 0], [3, 6, 0], [6, 6])
  const modelVChains = boxModel(texture, materialPicker, [-6, -6, 0], [12, 6, 0], [14, 6])

  const transform = new THREE.Matrix4().makeTranslation(x, y, z)
  if (blockState.blockName.includes('wall')) {
    const rotation = fromFacingToRotation(blockState.blockProperties['facing'])
    transform
      .multiply(new THREE.Matrix4().makeTranslation(0.5, 0.9375, 0.5))
      .multiply(new THREE.Matrix4().makeRotationY((rotation.y / 180) * Math.PI))
      .multiply(new THREE.Matrix4().makeTranslation(0, -0.3125, 0))
  } else {
    const rotation = parseInt(blockState.blockProperties['rotation'])
    transform
      .multiply(new THREE.Matrix4().makeTranslation(0.5, 0.9375, 0.5))
      .multiply(new THREE.Matrix4().makeRotationY((-rotation / 8) * Math.PI))
      .multiply(new THREE.Matrix4().makeTranslation(0, -0.3125, 0))
  }
  transform.multiply(new THREE.Matrix4().makeScale(1, -1, -1))
  const chainL1Matrix = new THREE.Matrix4()
    .multiply(transform)
    .multiply(new THREE.Matrix4().makeTranslation(-5 / 16, -6 / 16, 0))
    .multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 4))
  const chainL2Matrix = new THREE.Matrix4()
    .multiply(transform)
    .multiply(new THREE.Matrix4().makeTranslation(-5 / 16, -6 / 16, 0))
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 4))
  const chainR1Matrix = new THREE.Matrix4()
    .multiply(transform)
    .multiply(new THREE.Matrix4().makeTranslation(5 / 16, -6 / 16, 0))
    .multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 4))
  const chainR2Matrix = new THREE.Matrix4()
    .multiply(transform)
    .multiply(new THREE.Matrix4().makeTranslation(5 / 16, -6 / 16, 0))
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 4))

  const material = (animated: boolean) => {
    const material = animated
      ? materialPicker.animatedTexture.cutout
      : materialPicker.staticTexture.cutout
    const materialClone = material.clone()
    materialClone.side = THREE.DoubleSide
    return materialClone
  }

  renderModelNoCullsWithMS(modelBoard, blockState, material, scene, transform, true)
  if (blockState.blockName.includes('wall')) {
    renderModelNoCullsWithMS(modelPlank, blockState, material, scene, transform, true)
    renderModelNoCullsWithMS(modelChain1, blockState, material, scene, chainL1Matrix, true)
    renderModelNoCullsWithMS(modelChain2, blockState, material, scene, chainL2Matrix, true)
    renderModelNoCullsWithMS(modelChain1, blockState, material, scene, chainR1Matrix, true)
    renderModelNoCullsWithMS(modelChain2, blockState, material, scene, chainR2Matrix, true)
  } else {
    if (blockState.blockProperties['attached'] === 'false') {
      renderModelNoCullsWithMS(modelChain1, blockState, material, scene, chainL1Matrix, true)
      renderModelNoCullsWithMS(modelChain2, blockState, material, scene, chainL2Matrix, true)
      renderModelNoCullsWithMS(modelChain1, blockState, material, scene, chainR1Matrix, true)
      renderModelNoCullsWithMS(modelChain2, blockState, material, scene, chainR2Matrix, true)
    } else {
      renderModelNoCullsWithMS(modelVChains, blockState, material, scene, transform, true)
    }
  }
}